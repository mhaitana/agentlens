import type {
  CommandClassification,
  CommandScope,
  FileOperation,
  VerificationKind,
} from "@agentlens/domain";

/**
 * Tool-call classification helpers (spec §10.7–10.9).
 *
 * These derive non-sensitive metadata (operation kind, executable, family,
 * classification, scope) from a tool name + its raw input. Sensitive content
 * (paths, command arguments) is left raw here and redacted by the importer.
 */

/** Normalise a file operation from a tool name (§10.7). */
export function fileOperationFor(toolName: string): FileOperation | undefined {
  switch (toolName) {
    case "Read":
      return "read";
    case "Write":
      return "write";
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "edit";
    case "Grep":
      return "search";
    case "Glob":
      return "list";
    default:
      return undefined;
  }
}

/** Whether a tool touches the filesystem (and thus yields file activity). */
export function isFileTool(toolName: string): boolean {
  return fileOperationFor(toolName) !== undefined;
}

/** Extract the raw file path from a tool input, when present. */
export function filePathFromInput(_toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  // Most file tools use `file_path`; NotebookEdit uses `notebook_path`.
  const raw = (obj.file_path as string | undefined) ?? (obj.notebook_path as string | undefined);
  return typeof raw === "string" ? raw : undefined;
}

/** Detect the Bash tool (the only shell-command tool we classify). */
export function isBashTool(toolName: string): boolean {
  return toolName === "Bash";
}

interface ClassifiedCommand {
  executable: string;
  family: string;
  classification: CommandClassification;
  scope: CommandScope;
}

/** Classify a raw shell command string (§10.8). */
export function classifyCommand(rawCommand: string): ClassifiedCommand {
  const trimmed = rawCommand.trim();
  // Strip leading env assignments (e.g. `FOO=bar cmd`).
  const tokens = trimmed
    .split(/\s+/)
    .filter((t) => t.length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
  const first = tokens[0] ?? "";

  const { executable, family } = resolveExecutable(first);
  const classification = classifyByCommand(executable, family, trimmed);
  const scope = scopeOf(executable, family, trimmed);
  return { executable, family, classification, scope };
}

function resolveExecutable(first: string): { executable: string; family: string } {
  if (!first) return { executable: "", family: "" };
  // Strip path components: `/usr/bin/npm` → `npm`.
  const base = first.replace(/^.*\//, "");
  const family = baseFamily(base);
  return { executable: base, family };
}

function baseFamily(exec: string): string {
  if (exec === "npx") return "npm";
  if (exec === "pnpx" || exec === "pnpm") return "pnpm";
  if (exec === "yarn") return "yarn";
  if (exec === "gradlew" || exec === "mvnw") return exec;
  return exec;
}

function classifyByCommand(
  _executable: string,
  family: string,
  command: string,
): CommandClassification {
  const c = command.toLowerCase();
  if (family === "git") {
    if (/\bcommit\b/.test(c)) return "git";
    return "git";
  }
  if (isRun(command, ["test", "tst", "vitest", "jest"])) return "test";
  if (isRun(command, ["build", "compile"])) return "build";
  if (isRun(command, ["lint", "eslint", "biome", "ruff", "flake8"])) return "lint";
  if (isRun(command, ["typecheck", "type-check", "tsc", "mypy", "pyright"])) return "typecheck";
  if (isRun(command, ["format", "prettier", "black", "rustfmt"])) return "format";
  if (isRun(command, ["audit", "snyk", "trivy", "grype", "semgrep", "gitleaks"]))
    return "security-scan";
  if (isRun(command, ["install", "add", "i ", "ci"])) return "install";
  if (isRun(command, ["dev", "start", "serve", "run"])) return "run";
  return "other";
}

/** Match a command verb appearing as a subcommand or standalone executable. */
function isRun(command: string, verbs: string[]): boolean {
  const tokens = command.toLowerCase().split(/\s+/);
  return verbs.some((v) => tokens.includes(v) || tokens[0] === v);
}

function scopeOf(_executable: string, _family: string, command: string): CommandScope {
  const c = command.toLowerCase();
  // Broad: repo-wide operations (build, repo-wide lint/format, install, audit).
  const broadVerbs = ["build", "lint", "format", "install", "audit", "typecheck"];
  if (broadVerbs.some((v) => new RegExp(`\\b${v}\\b`).test(c))) return "broad";
  if (/\b--all\b|\s\.\s|\*\s|\*$/.test(c)) return "broad";
  return "narrow";
}

/** Map a command classification to a verification kind (§10.9). */
export function verificationKindFor(
  classification: CommandClassification,
): VerificationKind | undefined {
  switch (classification) {
    case "test":
      // Coarse default; later phases distinguish unit/integration/e2e.
      return "unit-test";
    case "typecheck":
      return "type-check";
    case "lint":
      return "lint";
    case "format":
      return "format-check";
    case "build":
      return "build";
    case "security-scan":
      return "security-scan";
    default:
      return undefined;
  }
}

/** Detect a git commit id safely mentioned in a command (e.g. `git rev-parse`). */
export function gitCommitIdFromCommand(command: string): string | undefined {
  // Only capture explicit 40-char hex hashes; never parse arbitrary output.
  const match = command.match(/\b([0-9a-f]{40})\b/);
  return match?.[1];
}
