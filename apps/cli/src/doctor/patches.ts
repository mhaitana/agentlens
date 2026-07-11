/**
 * Safe patch generation (spec §15.9, §3.5).
 *
 * Turns Doctor findings into reviewable {@link ProposedPatch}es. Every patch:
 * - is minimal and preserves unrelated configuration/comments/formatting,
 * - carries a destination file, an impact statement, and a unified-diff preview,
 * - is validated on the proposed content *before* it is offered (and again after
 *   applying, in apply.ts),
 * - is refused (`refused: true`) when the edit would be unsafe or ambiguous,
 * - has `automaticallyApplicable: false` — the Doctor never auto-applies,
 * - never auto-enables bypass-permission modes or external data transmission.
 *
 * Patches only cover *edits to existing configuration*. New skills/hooks are
 * produced as structured drafts (drafts.ts) and surfaced on the report
 * separately; §15.9 lists them as possible patch outputs and the drafts satisfy
 * that. No patch writes into the user's Claude Code config from this module —
 * apply.ts does that, behind explicit approval.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PatchValidation, ProposedPatch, DoctorFinding, PatchKind } from "@agentlens/domain";
import type { ClaudeConfigSnapshot, SettingsFile } from "./inspect.js";
import { unifiedDiff } from "./diff.js";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Extract the slug portion of a finding id (e.g. "missing-project"). */
function slugOf(f: DoctorFinding): string {
  const rest = f.id.split(":")[1] ?? f.id;
  return rest.replace(/-\d+$/, "");
}

function readFileText(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function parseJson(path: string): Record<string, unknown> | null {
  const raw = readFileText(path);
  if (raw.trim() === "") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Top-level keys of a settings object (for unrelated-preservation checks). */
function topKeys(obj: Record<string, unknown> | null): string[] {
  return obj ? Object.keys(obj).sort() : [];
}

/* -------------------------------------------------------------------------- */
/* Validation (§15.9)                                                         */
/* -------------------------------------------------------------------------- */

const BYPASS_RE = /bypassPermissions|defaultMode["']?\s*[:=]\s*["']?bypass/i;
const TRANSMISSION_RE =
  /enabledPlugins|mcpServers|\bcurl\b|\bwget\b|\bssh\b|\bhttp:\/\/|\bhttps:\/\//i;

/**
 * Validate a proposed patch on its *after* content (§15.9). Checks parseability,
 * that bypass-permission modes were not introduced, that external transmission
 * was not enabled, and that unrelated top-level keys were preserved (for JSON).
 */
export function validatePatch(args: {
  kind: PatchKind;
  before: string;
  after: string;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  addedLines: string[];
}): PatchValidation {
  const notes: string[] = [];
  let parses = true;
  if (args.kind === "json-settings" || args.kind === "mcp-removal") {
    try {
      JSON.parse(args.after);
    } catch {
      parses = false;
      notes.push("Patched JSON does not parse.");
    }
  }
  // Bypass / external transmission checks scan only the ADDED lines (minimal diff).
  const added = args.addedLines.join("\n");
  const noBypassPermissions = !BYPASS_RE.test(added);
  if (!noBypassPermissions)
    notes.push("Patch would enable a bypass-permission mode — refused by policy.");
  const noExternalTransmission = !TRANSMISSION_RE.test(added);
  if (!noExternalTransmission)
    notes.push("Patch would enable external data transmission — refused by policy.");

  let unrelatedPreserved = true;
  if (args.beforeJson && args.afterJson) {
    const beforeKeys = new Set(topKeys(args.beforeJson));
    const afterKeys = new Set(topKeys(args.afterJson));
    // After may add keys (e.g. permissions where absent) but must not remove any.
    for (const k of beforeKeys) {
      if (!afterKeys.has(k)) {
        unrelatedPreserved = false;
        notes.push(`Patch removed an unrelated top-level key: ${k}.`);
      }
    }
  } else if (args.kind === "claude-md") {
    // Append-only: before content must remain a prefix of after.
    if (!args.after.startsWith(args.before)) {
      unrelatedPreserved = false;
      notes.push("CLAUDE.md patch is not append-only; existing content was altered.");
    }
  }
  return { parses, noBypassPermissions, noExternalTransmission, unrelatedPreserved, notes };
}

/** Compute the added lines of a unified diff (lines starting with '+' but not '+++'). */
export function addedLinesFromDiff(diff: string): string[] {
  return diff
    .split(/\r?\n/)
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

/** A patch that is refused by policy (unsafe/ambiguous/no-op). */
function refusedPatch(
  id: string,
  kind: PatchKind,
  finding: DoctorFinding,
  targetFile: string | undefined,
  reason: string,
): ProposedPatch {
  return {
    id,
    kind,
    targetFile,
    summary: `${finding.title} — patch refused`,
    impact: `AgentLens will not auto-generate this patch: ${reason}`,
    diff: "",
    addresses: [finding.id],
    automaticallyApplicable: false,
    validation: {
      parses: true,
      noBypassPermissions: true,
      noExternalTransmission: true,
      unrelatedPreserved: true,
      notes: [reason],
    },
    refused: true,
    refusalReason: reason,
  };
}

let patchSeq = 0;
function nextPatchId(kind: string): string {
  return `patch-${kind}-${++patchSeq}`;
}
function resetPatchSeq(): void {
  patchSeq = 0;
}

/* -------------------------------------------------------------------------- */
/* Per-finding patch builders                                                 */
/* -------------------------------------------------------------------------- */

/** Settings file for a finding scope (prefers the scope's own settings file). */
function settingsForScope(
  snap: ClaudeConfigSnapshot,
  scope: DoctorFinding["scope"],
): SettingsFile | undefined {
  return snap.settingsFiles.find((s) => s.scope === scope && s.parsed !== null);
}

function buildClaudeMdPatch(
  finding: DoctorFinding,
  snap: ClaudeConfigSnapshot,
  slug: string,
): ProposedPatch | null {
  if (!snap.projectPath) {
    return refusedPatch(
      nextPatchId("claude-md"),
      "claude-md",
      finding,
      undefined,
      "no --project given; cannot target a project CLAUDE.md",
    );
  }
  const target = join(snap.projectPath, "CLAUDE.md");
  const before = readFileText(target);
  const section = claudeMdSectionFor(slug);
  if (!section) return null;
  // Append-only (preserve unrelated content/comments, §15.9).
  const after =
    before.length === 0
      ? `# CLAUDE.md\n\n${section}\n`
      : `${before.replace(/\n*$/, "")}\n\n${section}\n`;
  if (after === before) {
    return refusedPatch(
      nextPatchId("claude-md"),
      "claude-md",
      finding,
      target,
      "the section is already present (no change needed)",
    );
  }
  const diff = unifiedDiff(before, after, "CLAUDE.md");
  const validation = validatePatch({
    kind: "claude-md",
    before,
    after,
    addedLines: addedLinesFromDiff(diff),
  });
  return {
    id: nextPatchId("claude-md"),
    kind: "claude-md",
    targetFile: target,
    summary: `Add ${slug.replace(/-/g, " ")} guidance to CLAUDE.md`,
    impact: `Appends a "${(section.split("\n")[0] ?? "").replace(/^#+\s*/, "")}" section to ${target}. Existing content is preserved.`,
    diff,
    addresses: [finding.id],
    automaticallyApplicable: false,
    validation,
    refused: false,
  };
}

function claudeMdSectionFor(slug: string): string | null {
  switch (slug) {
    case "missing-project":
      return [
        "## Build, test, verify",
        "- Build: `<replace with your build command, e.g. pnpm build>`",
        "- Test: `<replace with your test command, e.g. pnpm test>`",
        "- Verify: `<replace with typecheck/lint/e2e, e.g. pnpm typecheck && pnpm lint>`",
        "",
        "## Architecture",
        "- `<replace with a one-paragraph architecture overview>`",
        "- Repository boundaries: `<replace with the workspace/package layout>`",
      ].join("\n");
    case "missing-build-test-verify":
      return [
        "## Build, test, verify",
        "- Build: `<replace with your build command>`",
        "- Test: `<replace with your test command>`",
        "- Verify: `<replace with typecheck/lint/e2e>`",
      ].join("\n");
    case "missing-architecture":
      return [
        "## Architecture",
        "- `<replace with a one-paragraph architecture overview>`",
        "- Repository boundaries: `<replace with the workspace/package layout>`",
      ].join("\n");
    default:
      return null;
  }
}

/** Find the source settings path recorded in a finding's evidence references. */
function sourceSettingsPath(finding: DoctorFinding): string | undefined {
  for (const e of finding.evidence) {
    for (const r of e.references ?? []) {
      if (r.endsWith("settings.json") || r.endsWith("settings.local.json")) return r;
    }
  }
  return undefined;
}

function buildJsonSettingsPatch(
  finding: DoctorFinding,
  snap: ClaudeConfigSnapshot,
  slug: string,
): ProposedPatch | null {
  const sourcePath = sourceSettingsPath(finding) ?? settingsForScope(snap, finding.scope)?.path;
  if (!sourcePath) {
    return refusedPatch(
      nextPatchId("json-settings"),
      "json-settings",
      finding,
      undefined,
      "no writable settings file found for this scope",
    );
  }
  const beforeJson = parseJson(sourcePath);
  if (!beforeJson) {
    return refusedPatch(
      nextPatchId("json-settings"),
      "json-settings",
      finding,
      sourcePath,
      "settings file is unparseable; edit manually to avoid clobbering it",
    );
  }
  const before = readFileText(sourcePath);
  const edit = applyJsonEdit(beforeJson, slug, finding);
  if (!edit) return null; // slug not handled here
  if (edit.noop) {
    return refusedPatch(
      nextPatchId("json-settings"),
      "json-settings",
      finding,
      sourcePath,
      edit.noopReason ?? "no change needed",
    );
  }
  const after = JSON.stringify(edit.next, null, 2) + "\n";
  const diff = unifiedDiff(before, after, sourcePath);
  const validation = validatePatch({
    kind: "json-settings",
    before,
    after,
    beforeJson,
    afterJson: edit.next,
    addedLines: addedLinesFromDiff(diff),
  });
  if (
    !validation.parses ||
    !validation.noBypassPermissions ||
    !validation.noExternalTransmission ||
    !validation.unrelatedPreserved
  ) {
    return refusedPatch(
      nextPatchId("json-settings"),
      "json-settings",
      finding,
      sourcePath,
      "patch failed safety validation",
    );
  }
  return {
    id: nextPatchId("json-settings"),
    kind: "json-settings",
    targetFile: sourcePath,
    summary: edit.summary,
    impact: edit.impact,
    diff,
    addresses: [finding.id],
    automaticallyApplicable: false,
    validation,
    refused: false,
  };
}

interface JsonEdit {
  next: Record<string, unknown>;
  summary: string;
  impact: string;
  noop?: boolean;
  noopReason?: string;
}

/** Apply a minimal JSON edit for a slug. Returns null when the slug isn't a JSON-settings edit. */
function applyJsonEdit(
  obj: Record<string, unknown>,
  slug: string,
  finding: DoctorFinding,
): JsonEdit | null {
  switch (slug) {
    case "no-timeout":
    case "slow-hook": {
      const hooks = (obj.hooks ?? {}) as Record<string, unknown>;
      let touched = false;
      for (const blocks of Object.values(hooks)) {
        if (!Array.isArray(blocks)) continue;
        for (const b of blocks) {
          if (!b || typeof b !== "object") continue;
          const inner = (b as Record<string, unknown>).hooks;
          if (!Array.isArray(inner)) continue;
          for (const h of inner) {
            if (!h || typeof h !== "object") continue;
            const ho = h as Record<string, unknown>;
            if (slug === "no-timeout") {
              if (ho.timeout === undefined) {
                ho.timeout = 2000;
                touched = true;
              }
            } else {
              if (typeof ho.timeout === "number" && ho.timeout > 10_000) {
                ho.timeout = 2000;
                touched = true;
              }
            }
          }
        }
      }
      if (!touched)
        return {
          next: obj,
          summary: "",
          impact: "",
          noop: true,
          noopReason: "no matching hook without/inflated timeout",
        };
      return {
        next: obj,
        summary: "Add/reduce hook timeouts to 2000ms",
        impact:
          "Sets a 2000ms timeout on hook entries that had none (or a >10s timeout). Hooks stay near-zero-latency (§19).",
      };
    }
    case "duplicate-hook": {
      // Remove duplicate hook entries (identical event/matcher/command). Safe
      // because the duplicates are identical; keep the first of each group.
      const hooks = (obj.hooks ?? {}) as Record<string, unknown>;
      let removed = 0;
      for (const [event, blocks] of Object.entries(hooks)) {
        if (!Array.isArray(blocks)) continue;
        const seen = new Set<string>();
        const nextBlocks: unknown[] = [];
        for (const b of blocks) {
          if (!b || typeof b !== "object") {
            nextBlocks.push(b);
            continue;
          }
          const matcher = (b as Record<string, unknown>).matcher ?? "*";
          const inner = (b as Record<string, unknown>).hooks;
          if (!Array.isArray(inner)) {
            nextBlocks.push(b);
            continue;
          }
          const keepInner: unknown[] = [];
          for (const h of inner) {
            if (!h || typeof h !== "object") {
              keepInner.push(h);
              continue;
            }
            const key = `${event}|${matcher}|${JSON.stringify(h)}`;
            if (seen.has(key)) {
              removed += 1;
              continue;
            }
            seen.add(key);
            keepInner.push(h);
          }
          (b as Record<string, unknown>).hooks = keepInner;
          nextBlocks.push(b);
        }
        hooks[event] = nextBlocks;
      }
      obj.hooks = hooks;
      if (removed === 0)
        return {
          next: obj,
          summary: "",
          impact: "",
          noop: true,
          noopReason: "no duplicate hook entries found",
        };
      return {
        next: obj,
        summary: `Remove ${removed} duplicate hook entr${removed === 1 ? "y" : "ies"}`,
        impact:
          "Removes hook entries that were registered identically more than once. Non-duplicate hooks are preserved.",
      };
    }
    case "never-matches": {
      const perms = (obj.permissions ?? {}) as Record<string, unknown>;
      const lists = ["allow", "deny", "ask"] as const;
      let removed = 0;
      for (const effect of lists) {
        const arr = perms[effect];
        if (!Array.isArray(arr)) continue;
        const next = (arr as unknown[]).filter((r) => {
          if (typeof r !== "string") return true;
          const open = (r.match(/\(/g) ?? []).length;
          const close = (r.match(/\)/g) ?? []).length;
          if (open !== close) {
            removed += 1;
            return false;
          }
          return true;
        });
        perms[effect] = next;
      }
      obj.permissions = perms;
      if (removed === 0)
        return {
          next: obj,
          summary: "",
          impact: "",
          noop: true,
          noopReason: "no malformed permission rules found",
        };
      return {
        next: obj,
        summary: `Remove ${removed} malformed permission rule${removed === 1 ? "" : "s"}`,
        impact:
          "Removes permission rules with unbalanced parentheses that could never match. Other rules are preserved.",
      };
    }
    case "sensitive-not-denied": {
      const perms = (obj.permissions ?? {}) as Record<string, unknown>;
      const deny = Array.isArray(perms.deny) ? [...(perms.deny as string[])] : [];
      // Derive the sensitive path from the finding evidence.
      const path = finding.evidence
        .find((e) => e.signals?.some((s) => s.label === "path"))
        ?.signals?.find((s) => s.label === "path")?.value;
      const target = typeof path === "string" ? path : ".env";
      const rule = `Read(./${target})`;
      if (deny.includes(rule)) {
        return {
          next: obj,
          summary: "",
          impact: "",
          noop: true,
          noopReason: `deny rule ${rule} already present`,
        };
      }
      deny.push(rule);
      perms.deny = deny;
      obj.permissions = perms;
      return {
        next: obj,
        summary: `Add deny rule for ${rule}`,
        impact: `Adds "${rule}" to permissions.deny so the sensitive path is refused before any allow rule (deny → ask → allow).`,
      };
    }
    default:
      return null;
  }
}

function buildMcpRemovalPatch(
  finding: DoctorFinding,
  snap: ClaudeConfigSnapshot,
  slug: string,
): ProposedPatch | null {
  if (slug !== "misconfigured") return null;
  if (!snap.projectPath) {
    return refusedPatch(
      nextPatchId("mcp-removal"),
      "mcp-removal",
      finding,
      undefined,
      "no --project given; cannot target .mcp.json",
    );
  }
  const target = join(snap.projectPath, ".mcp.json");
  const beforeJson = parseJson(target);
  if (!beforeJson) {
    return refusedPatch(
      nextPatchId("mcp-removal"),
      "mcp-removal",
      finding,
      target,
      ".mcp.json is absent or unparseable; nothing safe to remove",
    );
  }
  const before = readFileText(target);
  const servers = (beforeJson.mcpServers ?? {}) as Record<string, unknown>;
  const name = finding.evidence
    .find((e) => e.signals?.some((s) => s.label === "name"))
    ?.signals?.find((s) => s.label === "name")?.value;
  const targetName = typeof name === "string" ? name : "";
  if (!targetName || !(targetName in servers)) {
    return refusedPatch(
      nextPatchId("mcp-removal"),
      "mcp-removal",
      finding,
      target,
      "could not identify the misconfigured server to remove",
    );
  }
  const next: Record<string, unknown> = { ...beforeJson };
  // Rebuild without the misconfigured server (object reconstruction, no dynamic delete).
  const nextServers = Object.fromEntries(Object.entries(servers).filter(([k]) => k !== targetName));
  next.mcpServers = nextServers;
  const after = JSON.stringify(next, null, 2) + "\n";
  const diff = unifiedDiff(before, after, target);
  const validation = validatePatch({
    kind: "mcp-removal",
    before,
    after,
    beforeJson,
    afterJson: next,
    addedLines: addedLinesFromDiff(diff),
  });
  if (!validation.parses || !validation.noExternalTransmission || !validation.unrelatedPreserved) {
    return refusedPatch(
      nextPatchId("mcp-removal"),
      "mcp-removal",
      finding,
      target,
      "patch failed safety validation",
    );
  }
  return {
    id: nextPatchId("mcp-removal"),
    kind: "mcp-removal",
    targetFile: target,
    summary: `Remove misconfigured MCP server "${targetName}"`,
    impact: `Removes "${targetName}" from .mcp.json (it had no command/url/transport). Other servers are preserved.`,
    diff,
    addresses: [finding.id],
    automaticallyApplicable: false,
    validation,
    refused: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Aggregator                                                                 */
/* -------------------------------------------------------------------------- */

/** Which slugs each patch kind handles. */
const CLAUDE_MD_SLUGS = new Set([
  "missing-project",
  "missing-build-test-verify",
  "missing-architecture",
]);
const JSON_SETTINGS_SLUGS = new Set([
  "no-timeout",
  "slow-hook",
  "duplicate-hook",
  "never-matches",
  "sensitive-not-denied",
]);
const MCP_SLUGS = new Set(["misconfigured"]);

/**
 * Build proposed patches for the given findings (§15.9). Findings whose
 * `fixability` is `manual-only` or `none` produce no patch (the Doctor does not
 * auto-generate unsafe/ambiguous edits). Each patch is validated up front and
 * refused if it fails safety checks.
 */
export function buildPatches(
  findings: DoctorFinding[],
  snap: ClaudeConfigSnapshot,
): ProposedPatch[] {
  resetPatchSeq();
  const out: ProposedPatch[] = [];
  for (const f of findings) {
    if (f.fixability === "manual-only" || f.fixability === "none") continue;
    const slug = slugOf(f);
    let patch: ProposedPatch | null = null;
    if (CLAUDE_MD_SLUGS.has(slug)) patch = buildClaudeMdPatch(f, snap, slug);
    else if (JSON_SETTINGS_SLUGS.has(slug)) {
      // sensitive-not-denied is best modelled as a permission-rule patch kind.
      const kind: PatchKind = slug === "sensitive-not-denied" ? "permission-rule" : "json-settings";
      patch = buildJsonSettingsPatch(f, snap, slug);
      if (patch && !patch.refused) patch.kind = kind;
    } else if (MCP_SLUGS.has(slug)) patch = buildMcpRemovalPatch(f, snap, slug);
    if (patch) {
      out.push(patch);
      f.patchId = patch.id; // back-link (mutates the finding in place)
    }
  }
  return out;
}
