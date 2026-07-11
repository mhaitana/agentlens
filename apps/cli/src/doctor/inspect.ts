/**
 * Configuration Doctor — read-only inspection (spec §15.7, §12, §19).
 *
 * Discovers and parses Claude Code configuration across user/project/local
 * scopes into a neutral {@link ClaudeConfigSnapshot} that the check families
 * (§15.8) operate on. This is the *only* doctor module that knows Claude's
 * shapes; everything downstream consumes the snapshot and emits provider-neutral
 * {@link DoctorReport} types (§3.6).
 *
 * Safety invariants:
 * - Read-only. Nothing is written.
 * - Tolerant: a malformed file records a diagnostic and is skipped; it never
 *   fails the whole inspection (§12 — fields are version-dependent/unstable).
 * - No full file contents are retained — only metadata (bytes, lines,
 *   approximate tokens, a content hash for dedup, frontmatter fields). §3:
 *   never store full source-file contents.
 * - MCP env values are never read — only env-var *names* (§3.2, §15.8).
 * - Symlinks are not followed (§19).
 * - Tests never touch the developer's real `~/.claude`: every path is rooted at
 *   an explicit `claudeHome` / `projectPath`, honouring `AGENTLENS_CLAUDE_HOME`
 *   and `--project` (§21).
 *
 * Locations verified against official Claude Code docs (settings, hooks,
 * permissions, skills, agents, commands, MCP) — see §12.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { DoctorScope } from "@agentlens/domain";

/* -------------------------------------------------------------------------- */
/* Snapshot shape (neutral, metadata-only)                                    */
/* -------------------------------------------------------------------------- */

export interface SettingsFile {
  path: string;
  scope: DoctorScope;
  exists: boolean;
  parsed: Record<string, unknown> | null;
  bytes: number;
  parseError?: string;
}

export interface InstructionFile {
  path: string;
  scope: DoctorScope;
  /** Which instruction slot: CLAUDE.md, CLAUDE.local.md, or a .claude/rules file. */
  kind: "claude-md" | "claude-local-md" | "rule";
  bytes: number;
  lines: number;
  /** Heuristic char/4 token estimate — labelled approximate (§15.8). */
  approxTokens: number;
  /** sha256 content hash (truncated) for duplicate detection. Never the content. */
  contentHash: string;
  /** First non-frontmatter prose line, for duplicate/conflict hints. */
  firstLine: string;
}

export interface SkillEntry {
  name: string;
  path: string;
  scope: DoctorScope;
  description: string;
  frontmatterValid: boolean;
  bytes: number;
}

export interface CommandEntry {
  name: string;
  path: string;
  scope: DoctorScope;
  description: string;
  bytes: number;
}

export interface AgentEntry {
  name: string;
  path: string;
  scope: DoctorScope;
  description: string;
  /** Declared tool allowlist from frontmatter, if any. */
  tools: string[];
  frontmatterValid: boolean;
  bytes: number;
}

export interface HookEntry {
  event: string;
  matcher: string;
  type: string;
  command: string;
  scope: DoctorScope;
  sourcePath: string;
  timeoutMs?: number;
}

export interface McpServerEntry {
  name: string;
  scope: DoctorScope;
  sourcePath: string;
  command?: string;
  args?: string[];
  url?: string;
  envKeys: string[];
  transport: "stdio" | "sse" | "http" | "unknown";
}

export interface PermissionEntry {
  rule: string;
  effect: "allow" | "deny" | "ask";
  scope: DoctorScope;
  sourcePath: string;
}

export interface PluginEntry {
  id: string;
  enabled: boolean;
  scope: DoctorScope;
  sourcePath: string;
}

export interface DefaultModeEntry {
  scope: DoctorScope;
  mode: string;
  sourcePath: string;
}

export interface DiagnosticEntry {
  path: string;
  message: string;
}

export interface ClaudeConfigSnapshot {
  claudeHome: string;
  projectPath?: string;
  settingsFiles: SettingsFile[];
  instructions: InstructionFile[];
  skills: SkillEntry[];
  commands: CommandEntry[];
  agents: AgentEntry[];
  hooks: HookEntry[];
  mcpServers: McpServerEntry[];
  permissions: PermissionEntry[];
  plugins: PluginEntry[];
  defaultModes: DefaultModeEntry[];
  diagnostics: DiagnosticEntry[];
}

/* -------------------------------------------------------------------------- */
/* Path resolution                                                            */
/* -------------------------------------------------------------------------- */

/** Resolve the Claude Code user home (`~/.claude`), honouring overrides (§21). */
export function resolveClaudeHome(override?: string): string {
  const env = (process.env.AGENTLENS_CLAUDE_HOME || "").trim();
  const raw = (override && override.trim()) || env;
  if (raw) return raw;
  return join(homedir(), ".claude");
}

/** Resolve a project root, honouring `--project` / `AGENTLENS_DOCTOR_PROJECT`. */
export function resolveProjectPath(override?: string): string | undefined {
  const env = (process.env.AGENTLENS_DOCTOR_PROJECT || "").trim();
  const raw = (override && override.trim()) || env;
  return raw || undefined;
}

/* -------------------------------------------------------------------------- */
/* Tolerant helpers                                                           */
/* -------------------------------------------------------------------------- */

function readJsonTolerant(path: string): {
  parsed: Record<string, unknown> | null;
  bytes: number;
  error?: string;
} {
  if (!existsSync(path)) return { parsed: null, bytes: 0 };
  let bytes = 0;
  try {
    const raw = readFileSync(path, "utf8");
    bytes = Buffer.byteLength(raw, "utf8");
    if (raw.trim() === "") return { parsed: {}, bytes };
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { parsed: value as Record<string, unknown>, bytes };
    }
    return { parsed: null, bytes, error: "settings file is not a JSON object" };
  } catch (err) {
    return { parsed: null, bytes, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Minimal YAML frontmatter parser (no dependency). Returns the frontmatter map
 * and whether the block was well-formed (opened AND closed with `---`). Tolerant
 * of files with no frontmatter. Only parses simple `key: value` and `key: [a, b]`
 * lines — enough for name/description/tools.
 */
export interface Frontmatter {
  fields: Record<string, string | string[]>;
  valid: boolean;
}

export function parseFrontmatter(content: string): Frontmatter {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { fields: {}, valid: false };
  const fields: Record<string, string | string[]> = {};
  let closed = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") {
      closed = true;
      break;
    }
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1] ?? "";
    const rawVal = m[2] ?? "";
    if (!key) continue;
    const v = rawVal.trim();
    if (v.startsWith("[") && v.endsWith("]")) {
      const inner = v.slice(1, -1);
      fields[key] = inner
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0);
    } else {
      fields[key] = v.replace(/^["']|["']$/g, "");
    }
  }
  return { fields, valid: closed };
}

function fmString(fields: Record<string, string | string[]>, key: string): string {
  const v = fields[key];
  return typeof v === "string" ? v : "";
}

function fmStrings(fields: Record<string, string | string[]>, key: string): string[] {
  const v = fields[key];
  return Array.isArray(v) ? v : [];
}

/** Heuristic char/4 token estimate, labelled approximate (§15.8). */
function approxTokens(content: string): number {
  return Math.max(1, Math.round(content.length / 4));
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** First non-empty, non-frontmatter prose line, for dedup/conflict hints. */
function firstProseLine(content: string): string {
  const lines = content.split(/\r?\n/);
  let inFm = false;
  let fmStarted = false;
  for (const line of lines) {
    if (line.trim() === "---") {
      if (!fmStarted) {
        fmStarted = true;
        inFm = true;
        continue;
      }
      if (inFm) {
        inFm = false;
        continue;
      }
    }
    if (inFm) continue;
    const t = line.trim();
    if (t.length === 0 || t.startsWith("#")) continue;
    return t.slice(0, 120);
  }
  return "";
}

/** List regular files in a directory (skip symlinks, §19). Returns [] if absent. */
function listMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) continue;
    if (!e.isFile()) continue;
    const ext = extname(e.name).toLowerCase();
    if (ext === ".md" || ext === ".json") out.push(join(dir, e.name));
  }
  return out;
}

/** List skill directories (each holds a SKILL.md). Returns [] if absent. */
function listSkillDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    if (!e.isDirectory()) continue;
    if (existsSync(join(dir, e.name, "SKILL.md"))) out.push(join(dir, e.name));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Instructions (CLAUDE.md / CLAUDE.local.md / .claude/rules)                 */
/* -------------------------------------------------------------------------- */

function readInstructionFile(
  path: string,
  scope: DoctorScope,
  kind: InstructionFile["kind"],
): InstructionFile | null {
  if (!existsSync(path)) return null;
  let content = "";
  let bytes = 0;
  try {
    content = readFileSync(path, "utf8");
    bytes = Buffer.byteLength(content, "utf8");
  } catch {
    return null;
  }
  return {
    path,
    scope,
    kind,
    bytes,
    lines: content.split(/\r?\n/).length,
    approxTokens: approxTokens(content),
    contentHash: contentHash(content),
    firstLine: firstProseLine(content),
  };
}

function collectInstructions(
  claudeHome: string,
  projectPath: string | undefined,
): InstructionFile[] {
  const out: InstructionFile[] = [];
  // User-level CLAUDE.md
  const userMd = readInstructionFile(join(claudeHome, "CLAUDE.md"), "user", "claude-md");
  if (userMd) out.push(userMd);
  if (projectPath) {
    // Project instructions: CLAUDE.md and .claude/CLAUDE.md (both observed in the wild).
    for (const rel of ["CLAUDE.md", ".claude/CLAUDE.md"]) {
      const f = readInstructionFile(join(projectPath, rel), "project", "claude-md");
      if (f) out.push(f);
    }
    const localMd = readInstructionFile(
      join(projectPath, "CLAUDE.local.md"),
      "local",
      "claude-local-md",
    );
    if (localMd) out.push(localMd);
    // Project rules
    const rulesDir = join(projectPath, ".claude", "rules");
    for (const p of listMdFiles(rulesDir)) {
      const f = readInstructionFile(p, "project", "rule");
      if (f) out.push(f);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Skills / commands / agents                                                 */
/* -------------------------------------------------------------------------- */

function collectSkills(claudeHome: string, projectPath: string | undefined): SkillEntry[] {
  const out: SkillEntry[] = [];
  const scopes: Array<{ dir: string; scope: DoctorScope }> = [
    { dir: join(claudeHome, "skills"), scope: "user" },
  ];
  if (projectPath) scopes.push({ dir: join(projectPath, ".claude", "skills"), scope: "project" });
  for (const { dir, scope } of scopes) {
    for (const skillDir of listSkillDirs(dir)) {
      const path = join(skillDir, "SKILL.md");
      let content = "";
      try {
        content = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content);
      out.push({
        name: basename(skillDir),
        path,
        scope,
        description: fmString(fm.fields, "description"),
        frontmatterValid: fm.valid && fmString(fm.fields, "name").length > 0,
        bytes: Buffer.byteLength(content, "utf8"),
      });
    }
  }
  return out;
}

function collectCommands(claudeHome: string, projectPath: string | undefined): CommandEntry[] {
  const out: CommandEntry[] = [];
  const scopes: Array<{ dir: string; scope: DoctorScope }> = [
    { dir: join(claudeHome, "commands"), scope: "user" },
  ];
  if (projectPath) scopes.push({ dir: join(projectPath, ".claude", "commands"), scope: "project" });
  for (const { dir, scope } of scopes) {
    for (const p of listMdFiles(dir)) {
      let content = "";
      try {
        content = readFileSync(p, "utf8");
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content);
      out.push({
        name: basename(p, ".md"),
        path: p,
        scope,
        description: fmString(fm.fields, "description"),
        bytes: Buffer.byteLength(content, "utf8"),
      });
    }
  }
  return out;
}

function collectAgents(claudeHome: string, projectPath: string | undefined): AgentEntry[] {
  const out: AgentEntry[] = [];
  const scopes: Array<{ dir: string; scope: DoctorScope }> = [
    { dir: join(claudeHome, "agents"), scope: "user" },
  ];
  if (projectPath) scopes.push({ dir: join(projectPath, ".claude", "agents"), scope: "project" });
  for (const { dir, scope } of scopes) {
    for (const p of listMdFiles(dir)) {
      let content = "";
      try {
        content = readFileSync(p, "utf8");
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content);
      out.push({
        name: basename(p, ".md"),
        path: p,
        scope,
        description: fmString(fm.fields, "description"),
        tools: fmStrings(fm.fields, "tools"),
        frontmatterValid: fm.valid && fmString(fm.fields, "name").length > 0,
        bytes: Buffer.byteLength(content, "utf8"),
      });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Settings: hooks / permissions / plugins / defaultMode                      */
/* -------------------------------------------------------------------------- */

interface HookSpec {
  event: string;
  matcher: string;
  type: string;
  command: string;
  timeoutMs?: number;
}

/** Extract hook specs from a settings object (tolerant of shape variation, §12). */
function extractHooks(settings: Record<string, unknown>): HookSpec[] {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return [];
  const out: HookSpec[] = [];
  const byEvent = hooks as Record<string, unknown>;
  for (const [event, val] of Object.entries(byEvent)) {
    if (!Array.isArray(val)) continue;
    for (const block of val) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      const matcher = typeof b.matcher === "string" ? b.matcher : "*";
      const inner = b.hooks;
      if (!Array.isArray(inner)) continue;
      for (const h of inner) {
        if (!h || typeof h !== "object") continue;
        const ho = h as Record<string, unknown>;
        const type = typeof ho.type === "string" ? ho.type : "command";
        const cmd =
          typeof ho.command === "string"
            ? ho.command
            : typeof ho.script === "string"
              ? ho.script
              : "";
        const timeoutMs =
          typeof ho.timeout === "number"
            ? ho.timeout
            : typeof ho.timeout === "string"
              ? Number(ho.timeout) || undefined
              : undefined;
        out.push({ event, matcher, type, command: cmd, timeoutMs });
      }
    }
  }
  return out;
}

/** Extract permission rules from a settings object (tolerant, §12). */
function extractPermissions(
  settings: Record<string, unknown>,
): Array<{ rule: string; effect: "allow" | "deny" | "ask" } & { defaultMode?: string }> {
  const perms = settings.permissions;
  if (!perms || typeof perms !== "object" || Array.isArray(perms)) return [];
  const p = perms as Record<string, unknown>;
  const out: Array<{ rule: string; effect: "allow" | "deny" | "ask"; defaultMode?: string }> = [];
  for (const effect of ["allow", "deny", "ask"] as const) {
    const list = p[effect];
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      if (typeof r === "string" && r.trim()) out.push({ rule: r.trim(), effect });
    }
  }
  if (typeof p.defaultMode === "string") {
    out.push({ rule: `defaultMode=${p.defaultMode}`, effect: "allow", defaultMode: p.defaultMode });
  }
  return out;
}

function extractPlugins(settings: Record<string, unknown>): PluginEntry[] {
  const out: PluginEntry[] = [];
  const ep = settings.enabledPlugins;
  if (ep && typeof ep === "object" && !Array.isArray(ep)) {
    for (const [id, val] of Object.entries(ep as Record<string, unknown>)) {
      out.push({ id, enabled: val === true, scope: "user", sourcePath: "" });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* MCP (.mcp.json project + ~/.claude.json user)                              */
/* -------------------------------------------------------------------------- */

function collectMcpServers(
  claudeHome: string,
  projectPath: string | undefined,
  diagnostics: DiagnosticEntry[],
): McpServerEntry[] {
  const out: McpServerEntry[] = [];
  // Project scope: <project>/.mcp.json
  if (projectPath) {
    const p = join(projectPath, ".mcp.json");
    if (existsSync(p)) {
      const { parsed } = readJsonTolerant(p);
      if (parsed) {
        const servers = parsed.mcpServers;
        if (servers && typeof servers === "object" && !Array.isArray(servers)) {
          for (const [name, val] of Object.entries(servers as Record<string, unknown>)) {
            out.push(mcpEntry(name, "project", p, val));
          }
        } else if (parsed.mcpServers !== undefined) {
          diagnostics.push({ path: p, message: ".mcp.json mcpServers is not an object" });
        }
      }
    }
  }
  // User scope: ~/.claude.json (holds per-project mcpServers + a top-level set).
  const userMcp = join(claudeHome, "..", ".claude.json");
  // ~/.claude.json lives one level above ~/.claude, i.e. in the home dir.
  const userMcpPath = join(dirname(claudeHome), ".claude.json");
  const candidate = existsSync(userMcpPath) ? userMcpPath : existsSync(userMcp) ? userMcp : null;
  if (candidate) {
    const { parsed } = readJsonTolerant(candidate);
    if (parsed) {
      const top = parsed.mcpServers;
      if (top && typeof top === "object" && !Array.isArray(top)) {
        for (const [name, val] of Object.entries(top as Record<string, unknown>)) {
          out.push(mcpEntry(name, "user", candidate, val));
        }
      }
      // Per-project entries: { "projects": { "<path>": { "mcpServers": {...} } } }
      const projects = parsed.projects;
      if (projects && typeof projects === "object" && !Array.isArray(projects)) {
        for (const [, pval] of Object.entries(projects as Record<string, unknown>)) {
          if (!pval || typeof pval !== "object") continue;
          const servers = (pval as Record<string, unknown>).mcpServers;
          if (servers && typeof servers === "object" && !Array.isArray(servers)) {
            for (const [name, val] of Object.entries(servers as Record<string, unknown>)) {
              out.push(mcpEntry(name, "user", candidate, val));
            }
          }
        }
      }
    }
  }
  return out;
}

function mcpEntry(
  name: string,
  scope: DoctorScope,
  sourcePath: string,
  val: unknown,
): McpServerEntry {
  const v = (val && typeof val === "object" ? val : {}) as Record<string, unknown>;
  const transport: McpServerEntry["transport"] =
    typeof v.url === "string" && typeof v.type === "string" && v.type === "sse"
      ? "sse"
      : typeof v.url === "string"
        ? "http"
        : typeof v.command === "string"
          ? "stdio"
          : "unknown";
  const env = v.env;
  const envKeys =
    env && typeof env === "object" && !Array.isArray(env)
      ? Object.keys(env as Record<string, unknown>)
      : [];
  const args = Array.isArray(v.args)
    ? ((v.args as unknown[]).filter((a) => typeof a === "string") as string[])
    : undefined;
  return {
    name,
    scope,
    sourcePath,
    command: typeof v.command === "string" ? v.command : undefined,
    args,
    url: typeof v.url === "string" ? v.url : undefined,
    envKeys,
    transport,
  };
}

/* -------------------------------------------------------------------------- */
/* Top-level inspection                                                       */
/* -------------------------------------------------------------------------- */

export interface InspectOptions {
  claudeHomeOverride?: string;
  projectPathOverride?: string;
}

/**
 * Inspect Claude Code configuration across scopes (§15.7). Read-only and
 * tolerant: every malformed file becomes a diagnostic, never an exception.
 */
export function inspectConfig(opts: InspectOptions = {}): ClaudeConfigSnapshot {
  const claudeHome = resolveClaudeHome(opts.claudeHomeOverride);
  const projectPath = resolveProjectPath(opts.projectPathOverride);
  const diagnostics: DiagnosticEntry[] = [];

  // Settings files (user / project / local).
  const settingsSpecs: Array<{ path: string; scope: DoctorScope }> = [
    { path: join(claudeHome, "settings.json"), scope: "user" },
  ];
  if (projectPath) {
    settingsSpecs.push(
      { path: join(projectPath, ".claude", "settings.json"), scope: "project" },
      { path: join(projectPath, ".claude", "settings.local.json"), scope: "local" },
    );
  }
  const settingsFiles: SettingsFile[] = [];
  for (const spec of settingsSpecs) {
    const { parsed, bytes, error } = readJsonTolerant(spec.path);
    const exists = existsSync(spec.path);
    settingsFiles.push({
      path: spec.path,
      scope: spec.scope,
      exists,
      parsed,
      bytes,
      parseError: error,
    });
    if (error) diagnostics.push({ path: spec.path, message: error });
  }

  // Derive hooks / permissions / plugins / defaultMode from parsed settings.
  const hooks: HookEntry[] = [];
  const permissions: PermissionEntry[] = [];
  const plugins: PluginEntry[] = [];
  const defaultModes: DefaultModeEntry[] = [];
  for (const sf of settingsFiles) {
    if (!sf.parsed) continue;
    for (const h of extractHooks(sf.parsed)) {
      hooks.push({ ...h, scope: sf.scope, sourcePath: sf.path });
    }
    for (const pe of extractPermissions(sf.parsed)) {
      if (pe.defaultMode) {
        defaultModes.push({ scope: sf.scope, mode: pe.defaultMode, sourcePath: sf.path });
      } else {
        permissions.push({
          rule: pe.rule,
          effect: pe.effect,
          scope: sf.scope,
          sourcePath: sf.path,
        });
      }
    }
    for (const pl of extractPlugins(sf.parsed)) {
      plugins.push({ ...pl, scope: sf.scope, sourcePath: sf.path });
    }
  }

  const instructions = collectInstructions(claudeHome, projectPath);
  const skills = collectSkills(claudeHome, projectPath);
  const commands = collectCommands(claudeHome, projectPath);
  const agents = collectAgents(claudeHome, projectPath);
  const mcpServers = collectMcpServers(claudeHome, projectPath, diagnostics);

  return {
    claudeHome,
    projectPath,
    settingsFiles,
    instructions,
    skills,
    commands,
    agents,
    hooks,
    mcpServers,
    permissions,
    plugins,
    defaultModes,
    diagnostics,
  };
}

/** Re-export for callers that want byte sizes without re-reading. */
export function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
