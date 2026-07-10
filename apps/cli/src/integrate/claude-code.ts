/**
 * Claude Code integration logic (spec §14.5) — detection, planning, backup,
 * install, status, and removal for the observation-only AgentLens plugin.
 *
 * Testable in isolation: every filesystem touch is rooted at an explicit
 * `claudeHome` (the `~/.claude` dir) and `agentLensHome` (the AgentLens data
 * home). No function reads the developer's real `~/.claude` unless the caller
 * passes it in (§21). Tests pass temp dirs.
 *
 * Registration mechanism (documented, reversible): we write the AgentLens-owned
 * local marketplace into `<agentLensHome>/integration/claude-marketplace/` and
 * register it in Claude Code's user settings (`~/.claude/settings.json`) via
 * `extraKnownMarketplaces` + `enabledPlugins` — the same keys Claude Code's own
 * "require marketplaces for your team" flow writes — and mirror the entry in
 * `~/.claude/plugins/known_marketplaces.json`. Removal deletes ONLY the
 * AgentLens-owned keys and the materialized marketplace dir; unrelated hooks,
 * plugins, and formatting are preserved (§14.5 step 7/8, §14.11).
 *
 * Per §12, Claude Code's plugin fields are version-dependent and partly
 * undocumented; we treat them as unstable, validate what we write, and key our
 * own bookkeeping on stable names (`agentlens-local`, `agentlens-claude`) rather
 * than on the exact source-shape so removal stays correct across versions.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
  copyFileSync,
  statSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

/** Stable AgentLens-owned identifiers (used for bookkeeping + removal). */
export const MARKETPLACE_NAME = "agentlens-local";
export const PLUGIN_NAME = "agentlens-claude";
export const ENABLED_PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

/** Where the materialized local marketplace lives inside the AgentLens home. */
export const MARKETPLACE_REL = join("integration", "claude-marketplace");

export interface DetectionResult {
  found: boolean;
  binPath?: string;
  version?: string;
  /** Non-fatal reason when the binary couldn't be located. */
  note?: string;
}

export interface IntegrationStatus {
  detected: DetectionResult;
  registered: boolean;
  marketplaceInstalled: boolean;
  pluginManifestValid: boolean;
  hookEventCount: number;
  collectorOnline: boolean | "unknown";
  claudeSettingsPath: string;
  knownMarketplacesPath: string;
  marketplaceRoot: string;
  /** Other (non-AgentLens) enabled plugins, so the user can see context. */
  otherEnabledPlugins: string[];
}

export interface InstallPlan {
  detected: DetectionResult;
  alreadyRegistered: boolean;
  /** Files that will be backed up before any write. */
  backupTargets: string[];
  /** Settings.json keys AgentLens will add (none removed). */
  settingsAdds: string[];
  marketplaceRoot: string;
  pluginSourceDir: string;
  /** True if the marketplace dir already exists and is valid. */
  marketplaceExists: boolean;
}

export interface InstallResult {
  dryRun: boolean;
  backedUp: Array<{ path: string; backup: string }>;
  settingsPath: string;
  marketplaceRoot: string;
  registered: boolean;
  validation: { settingsParse: boolean; keysPresent: boolean; marketplaceValid: boolean };
  health: { collectorOnline: boolean | "unknown" };
  rollbackHint: string;
}

export interface RemoveResult {
  dryRun: boolean;
  backedUp: Array<{ path: string; backup: string }>;
  removedSettingsKeys: string[];
  removedMarketplace: boolean;
  otherPluginsPreserved: string[];
  rollbackHint: string;
}

export interface IntegrateOptions {
  /** Override `~/.claude` (tests / non-standard installs). */
  claudeHomeOverride?: string;
  /** Override the bundled plugin source directory (tests). */
  pluginSourceDirOverride?: string;
  /** Override the `claude` binary path (tests). */
  claudeBinOverride?: string;
}

/* -------------------------------------------------------------------------- */
/* Path resolution                                                            */
/* -------------------------------------------------------------------------- */

/** Resolve the Claude Code user home (`~/.claude`), honouring the test override. */
export function resolveClaudeHome(override?: string): string {
  const env = (process.env.AGENTLENS_CLAUDE_HOME || "").trim();
  const raw = (override && override.trim()) || env;
  if (raw) return raw;
  return join(homedir(), ".claude");
}

/** `~/.claude/settings.json`. */
export function claudeSettingsPath(claudeHome: string): string {
  return join(claudeHome, "settings.json");
}

/** `~/.claude/plugins/known_marketplaces.json` (marketplace registry). */
export function knownMarketplacesPath(claudeHome: string): string {
  return join(claudeHome, "plugins", "known_marketplaces.json");
}

/** Absolute path to the materialized marketplace inside the AgentLens home. */
export function marketplaceRoot(agentLensHome: string): string {
  return join(agentLensHome, MARKETPLACE_REL);
}

/**
 * Resolve the bundled plugin source directory (`plugins/agentlens-claude`).
 * Order: explicit override → `AGENTLENS_PLUGIN_DIR` env → repo-relative
 * candidates (works from both `src/` under vitest and `dist/` at runtime).
 */
export function resolvePluginSourceDir(override?: string): string {
  const env = (process.env.AGENTLENS_PLUGIN_DIR || "").trim();
  if (override && override.trim()) return override;
  if (env) return env;
  const here = dirname(fileURLToPath(import.meta.url));
  // From src/integrate/ or dist/integrate/ → four levels up reaches repo root.
  const candidates = [
    join(here, "..", "..", "..", "..", "plugins", "agentlens-claude"),
    join(here, "..", "..", "..", "plugins", "agentlens-claude"),
    join(here, "..", "..", "..", "..", "..", "plugins", "agentlens-claude"),
  ];
  for (const c of candidates) {
    if (
      existsSync(join(c, ".claude-plugin", "plugin.json")) &&
      existsSync(join(c, "hooks", "hooks.json"))
    ) {
      return c;
    }
  }
  throw new Error(
    "Could not locate the bundled agentlens-claude plugin directory. " +
      "Set AGENTLENS_PLUGIN_DIR or pass --plugin-dir.",
  );
}

/* -------------------------------------------------------------------------- */
/* JSON helpers (tolerant)                                                    */
/* -------------------------------------------------------------------------- */

function readJson<T = unknown>(path: string): T | null {
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode });
  try {
    renameSync(tmp, path); // atomic on same volume
  } catch {
    // Cross-device or other error: fall back to a direct write.
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode });
    rmSync(tmp, { force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Detection (§14.5 step 1/2 — best-effort, never fatal)                      */
/* -------------------------------------------------------------------------- */

/**
 * Detect the `claude` binary and its version. Best-effort: a missing binary
 * does not block install (the user may install Claude Code afterwards); we only
 * report it. `AGENTLENS_CLAUDE_BIN` lets tests stub the binary.
 */
export function detectClaude(opts: IntegrateOptions = {}): DetectionResult {
  const explicit = opts.claudeBinOverride || (process.env.AGENTLENS_CLAUDE_BIN || "").trim();
  const candidates = explicit
    ? [explicit]
    : process.platform === "win32"
      ? ["claude.exe", "claude"]
      : ["claude"];
  const useShell = process.platform === "win32";
  for (const bin of candidates) {
    try {
      const ver = spawnSync(bin, ["--version"], {
        encoding: "utf8",
        shell: useShell,
        timeout: 4000,
      });
      if (ver.error || ver.status == null) continue;
      const version = (ver.stdout || "").trim() || (ver.stderr || "").trim() || "unknown";
      return { found: true, binPath: bin, version };
    } catch {
      continue;
    }
  }
  return {
    found: false,
    note: "claude binary not found on PATH (install still works; enable on next Claude Code session)",
  };
}

/* -------------------------------------------------------------------------- */
/* Marketplace materialization                                                */
/* -------------------------------------------------------------------------- */

interface MarketplaceJson {
  name: string;
  owner: { name: string };
  plugins: Array<{ name: string; source: string; description: string }>;
}

function pluginDescription(pluginDir: string): string {
  const manifest = readJson<{ description?: string }>(
    join(pluginDir, ".claude-plugin", "plugin.json"),
  );
  return manifest?.description ?? "AgentLens observation-only Claude Code plugin";
}

/** Recursively copy the bundled plugin into the marketplace, preserving modes. */
function copyPlugin(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyPlugin(s, d);
    } else if (entry.isFile()) {
      copyFileSync(s, d);
      try {
        const st = statSync(s);
        chmodMaybe(d, st.mode & 0o777);
      } catch {
        // mode preservation is best-effort
      }
    }
    // symlinks are skipped (§19: don't follow/propagate untrusted symlinks).
  }
}

function chmodMaybe(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // best-effort (Windows ignores POSIX modes)
  }
}

/**
 * Materialize the local marketplace under `<agentLensHome>/integration/...`.
 * Idempotent: overwrites the marketplace.json + plugin tree on each call so
 * upgrades pick up new hook scripts. Returns the marketplace root.
 */
export function materializeMarketplace(agentLensHome: string, pluginSourceDir: string): string {
  const root = marketplaceRoot(agentLensHome);
  const pluginDest = join(root, "plugins", PLUGIN_NAME);
  // Wipe + rewrite the plugin tree so stale files don't linger across versions.
  rmSync(pluginDest, { recursive: true, force: true });
  copyPlugin(pluginSourceDir, pluginDest);
  const marketplaceJson: MarketplaceJson = {
    name: MARKETPLACE_NAME,
    owner: { name: "AgentLens" },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: `./plugins/${PLUGIN_NAME}`,
        description: pluginDescription(pluginSourceDir),
      },
    ],
  };
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify(marketplaceJson, null, 2) + "\n",
    {
      mode: 0o644,
    },
  );
  return root;
}

/** Whether the materialized marketplace + plugin manifest are present and valid. */
export function marketplaceValid(agentLensHome: string): boolean {
  const root = marketplaceRoot(agentLensHome);
  const mj = readJson<MarketplaceJson>(join(root, ".claude-plugin", "marketplace.json"));
  if (!mj || mj.name !== MARKETPLACE_NAME) return false;
  const hasPlugin = mj.plugins?.some((p) => p.name === PLUGIN_NAME) ?? false;
  if (!hasPlugin) return false;
  const manifest = join(root, "plugins", PLUGIN_NAME, ".claude-plugin", "plugin.json");
  const hooks = join(root, "plugins", PLUGIN_NAME, "hooks", "hooks.json");
  return existsSync(manifest) && existsSync(hooks);
}

/* -------------------------------------------------------------------------- */
/* Settings manipulation (preserve unrelated keys/hooks)                      */
/* -------------------------------------------------------------------------- */

interface ClaudeSettings {
  enabledPlugins?: Record<string, boolean>;
  extraKnownMarketplaces?: Record<string, unknown>;
  hooks?: Record<string, unknown>;
  [k: string]: unknown;
}

function isRegistered(settings: ClaudeSettings | null): boolean {
  if (!settings) return false;
  const mp = settings.extraKnownMarketplaces;
  const ep = settings.enabledPlugins;
  return Boolean(mp && mp[MARKETPLACE_NAME]) && Boolean(ep && ep[ENABLED_PLUGIN_KEY] === true);
}

function backupFile(path: string, agentLensHome: string, nowIso: string): string {
  const backupDir = join(agentLensHome, "backups");
  mkdirSync(backupDir, { recursive: true });
  const base =
    dirname(path) === agentLensHome
      ? "settings.json"
      : path.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  const stamp = nowIso.replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `${base}.${stamp}.bak`);
  if (existsSync(path)) copyFileSync(path, backupPath);
  else writeFileSync(backupPath, "{}\n", { mode: 0o600 }); // record that the file didn't exist
  return backupPath;
}

/** Build the install plan WITHOUT writing anything (§14.5 step 4). */
export function buildInstallPlan(
  claudeHome: string,
  agentLensHome: string,
  opts: IntegrateOptions = {},
): InstallPlan {
  const detected = detectClaude(opts);
  const settings = readJson<ClaudeSettings>(claudeSettingsPath(claudeHome));
  const alreadyRegistered = isRegistered(settings);
  const pluginSourceDir = resolvePluginSourceDir(opts.pluginSourceDirOverride);
  const root = marketplaceRoot(agentLensHome);
  const backupTargets: string[] = [];
  if (!alreadyRegistered || !existsSync(claudeSettingsPath(claudeHome)))
    backupTargets.push(claudeSettingsPath(claudeHome));
  if (!existsSync(knownMarketplacesPath(claudeHome)))
    backupTargets.push(knownMarketplacesPath(claudeHome));
  return {
    detected,
    alreadyRegistered,
    backupTargets,
    settingsAdds: alreadyRegistered
      ? []
      : [`extraKnownMarketplaces.${MARKETPLACE_NAME}`, `enabledPlugins.${ENABLED_PLUGIN_KEY}`],
    marketplaceRoot: root,
    pluginSourceDir,
    marketplaceExists: marketplaceValid(agentLensHome),
  };
}

/**
 * Apply the install (§14.5 steps 5–10). Backs up affected files, materializes
 * the marketplace, edits settings + known_marketplaces, validates, and probes
 * collector health. `dryRun` performs detection + planning + validation only.
 */
export function applyInstall(
  claudeHome: string,
  agentLensHome: string,
  opts: IntegrateOptions = {},
  dryRun = false,
  nowIso = new Date().toISOString(),
): InstallResult {
  const plan = buildInstallPlan(claudeHome, agentLensHome, opts);
  const backedUp: Array<{ path: string; backup: string }> = [];
  const settingsPath = claudeSettingsPath(claudeHome);
  const kmPath = knownMarketplacesPath(claudeHome);
  const root = marketplaceRoot(agentLensHome);

  if (dryRun) {
    return {
      dryRun: true,
      backedUp,
      settingsPath,
      marketplaceRoot: root,
      registered: plan.alreadyRegistered,
      validation: {
        settingsParse: true,
        keysPresent: plan.alreadyRegistered,
        marketplaceValid: plan.marketplaceExists,
      },
      health: { collectorOnline: probeCollector(agentLensHome) },
      rollbackHint: rollbackHint(agentLensHome),
    };
  }

  // Step 5: back up affected files.
  for (const p of plan.backupTargets)
    backedUp.push({ path: p, backup: backupFile(p, agentLensHome, nowIso) });
  if (existsSync(settingsPath) && !plan.backupTargets.includes(settingsPath)) {
    backedUp.push({ path: settingsPath, backup: backupFile(settingsPath, agentLensHome, nowIso) });
  }
  if (existsSync(kmPath))
    backedUp.push({ path: kmPath, backup: backupFile(kmPath, agentLensHome, nowIso) });

  // Step 6: materialize the marketplace + register the plugin.
  materializeMarketplace(agentLensHome, plan.pluginSourceDir);

  const settings = readJson<ClaudeSettings>(settingsPath) ?? ({} as ClaudeSettings);
  settings.extraKnownMarketplaces = settings.extraKnownMarketplaces ?? {};
  (settings.extraKnownMarketplaces as Record<string, unknown>)[MARKETPLACE_NAME] = {
    source: { source: "directory", path: root },
  };
  settings.enabledPlugins = settings.enabledPlugins ?? {};
  settings.enabledPlugins[ENABLED_PLUGIN_KEY] = true;
  writeJson(settingsPath, settings);

  // Mirror into known_marketplaces.json so `/plugin marketplace list` shows it.
  const km = (readJson<Record<string, unknown>>(kmPath) ?? {}) as Record<string, unknown>;
  km[MARKETPLACE_NAME] = {
    source: { source: "directory", path: root },
    installLocation: root,
    lastUpdated: nowIso,
  };
  writeJson(kmPath, km);

  // Step 8: validate the result.
  const reparsed = readJson<ClaudeSettings>(settingsPath);
  const validation = {
    settingsParse: reparsed !== null,
    keysPresent: isRegistered(reparsed),
    marketplaceValid: marketplaceValid(agentLensHome),
  };

  // Step 9: health check (non-fatal — spool fallback covers an offline collector).
  const collectorOnline = probeCollector(agentLensHome);

  return {
    dryRun: false,
    backedUp,
    settingsPath,
    marketplaceRoot: root,
    registered: validation.keysPresent,
    validation,
    health: { collectorOnline },
    rollbackHint: rollbackHint(agentLensHome),
  };
}

/**
 * Remove ONLY AgentLens-owned configuration (§14.5 "Removal must remove only
 * AgentLens-owned configuration", §14.11 "Integration removal leaves unrelated
 * settings intact"). Backs up first; preserves every other key + the user's
 * hooks + other enabled plugins; deletes the materialized marketplace dir.
 */
export function applyRemove(
  claudeHome: string,
  agentLensHome: string,
  _opts: IntegrateOptions = {},
  dryRun = false,
  nowIso = new Date().toISOString(),
): RemoveResult {
  const settingsPath = claudeSettingsPath(claudeHome);
  const kmPath = knownMarketplacesPath(claudeHome);
  const backedUp: Array<{ path: string; backup: string }> = [];
  const root = marketplaceRoot(agentLensHome);

  const settings = readJson<ClaudeSettings>(settingsPath);
  const km = readJson<Record<string, unknown>>(kmPath);

  const removedSettingsKeys: string[] = [];
  let otherPluginsPreserved: string[] = [];
  if (settings) {
    otherPluginsPreserved = Object.keys(settings.enabledPlugins ?? {}).filter(
      (k) => k !== ENABLED_PLUGIN_KEY,
    );
  }

  if (dryRun) {
    if (settings?.enabledPlugins?.[ENABLED_PLUGIN_KEY])
      removedSettingsKeys.push(`enabledPlugins.${ENABLED_PLUGIN_KEY}`);
    if (settings?.extraKnownMarketplaces?.[MARKETPLACE_NAME])
      removedSettingsKeys.push(`extraKnownMarketplaces.${MARKETPLACE_NAME}`);
    if (km?.[MARKETPLACE_NAME]) removedSettingsKeys.push(`known_marketplaces.${MARKETPLACE_NAME}`);
    return {
      dryRun: true,
      backedUp,
      removedSettingsKeys,
      removedMarketplace: marketplaceValid(agentLensHome),
      otherPluginsPreserved,
      rollbackHint: rollbackHint(agentLensHome),
    };
  }

  // Back up first.
  if (existsSync(settingsPath))
    backedUp.push({ path: settingsPath, backup: backupFile(settingsPath, agentLensHome, nowIso) });
  if (existsSync(kmPath))
    backedUp.push({ path: kmPath, backup: backupFile(kmPath, agentLensHome, nowIso) });

  if (settings) {
    if (settings.enabledPlugins && ENABLED_PLUGIN_KEY in settings.enabledPlugins) {
      // Rebuild without the owned key (object reconstruction avoids computed `delete`).
      const next = Object.fromEntries(
        Object.entries(settings.enabledPlugins).filter(([k]) => k !== ENABLED_PLUGIN_KEY),
      );
      if (Object.keys(next).length === 0) delete settings.enabledPlugins;
      else settings.enabledPlugins = next;
      removedSettingsKeys.push(`enabledPlugins.${ENABLED_PLUGIN_KEY}`);
    }
    if (settings.extraKnownMarketplaces && MARKETPLACE_NAME in settings.extraKnownMarketplaces) {
      const next = Object.fromEntries(
        Object.entries(settings.extraKnownMarketplaces).filter(([k]) => k !== MARKETPLACE_NAME),
      );
      if (Object.keys(next).length === 0) delete settings.extraKnownMarketplaces;
      else settings.extraKnownMarketplaces = next;
      removedSettingsKeys.push(`extraKnownMarketplaces.${MARKETPLACE_NAME}`);
    }
    writeJson(settingsPath, settings);
  }

  if (km) {
    if (MARKETPLACE_NAME in km) {
      const nextKm = Object.fromEntries(Object.entries(km).filter(([k]) => k !== MARKETPLACE_NAME));
      removedSettingsKeys.push(`known_marketplaces.${MARKETPLACE_NAME}`);
      writeJson(kmPath, nextKm);
    }
  }

  // Remove the materialized marketplace dir (AgentLens-owned).
  let removedMarketplace = false;
  if (existsSync(root)) {
    rmSync(root, { recursive: true, force: true });
    removedMarketplace = !existsSync(root);
  }

  return {
    dryRun: false,
    backedUp,
    removedSettingsKeys,
    removedMarketplace,
    otherPluginsPreserved,
    rollbackHint: rollbackHint(agentLensHome),
  };
}

/** Read-only status (§14.5 `--status`). */
export function buildStatus(
  claudeHome: string,
  agentLensHome: string,
  opts: IntegrateOptions = {},
): IntegrationStatus {
  const detected = detectClaude(opts);
  const settings = readJson<ClaudeSettings>(claudeSettingsPath(claudeHome));
  const registered = isRegistered(settings);
  const otherEnabledPlugins = settings
    ? Object.keys(settings.enabledPlugins ?? {}).filter((k) => k !== ENABLED_PLUGIN_KEY)
    : [];
  const root = marketplaceRoot(agentLensHome);
  const marketplaceInstalled = marketplaceValid(agentLensHome);
  let pluginManifestValid = false;
  let hookEventCount = 0;
  if (marketplaceInstalled) {
    const manifest = readJson<{ version?: string }>(
      join(root, "plugins", PLUGIN_NAME, ".claude-plugin", "plugin.json"),
    );
    pluginManifestValid = Boolean(manifest?.version);
    const hooks = readJson<{ hooks?: Record<string, unknown[]> }>(
      join(root, "plugins", PLUGIN_NAME, "hooks", "hooks.json"),
    );
    hookEventCount = hooks?.hooks ? Object.keys(hooks.hooks).length : 0;
  }
  return {
    detected,
    registered,
    marketplaceInstalled,
    pluginManifestValid,
    hookEventCount,
    collectorOnline: probeCollector(agentLensHome),
    claudeSettingsPath: claudeSettingsPath(claudeHome),
    knownMarketplacesPath: knownMarketplacesPath(claudeHome),
    marketplaceRoot: root,
    otherEnabledPlugins,
  };
}

/* -------------------------------------------------------------------------- */
/* Collector health probe (non-fatal; offline → spool fallback)               */
/* -------------------------------------------------------------------------- */

function probeCollector(agentLensHome: string): boolean | "unknown" {
  try {
    const rec = readJson<{ port?: number }>(join(agentLensHome, "runtime", "server.json"));
    if (!rec || typeof rec.port !== "number") return "unknown";
    const res = spawnSync(
      process.execPath,
      [
        "-e",
        `fetch("http://127.0.0.1:${rec.port}/api/v1/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
      ],
      {
        encoding: "utf8",
        timeout: 2000,
      },
    );
    return res.status === 0;
  } catch {
    return "unknown";
  }
}

function rollbackHint(agentLensHome: string): string {
  return `Restore the original files from ${join(agentLensHome, "backups")} (settings.json.*.bak), or run \`agentlens integrate claude-code --remove\`.`;
}
