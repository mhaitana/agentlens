import { resolve, isAbsolute, relative, sep } from "node:path";
import { sha256 } from "@agentlens/shared";
import { redactText, type RedactionOptions } from "./redact.js";

export interface RedactedPath {
  /** Privacy-mode-aware redacted path, when permitted; otherwise undefined. */
  redactedPath?: string;
  /** Stable hash of the canonical absolute path. */
  pathHash: string;
}

/**
 * Redact a file path: hash the canonical absolute path for correlation, and
 * produce a redacted relative path with the home prefix stripped and repo
 * anonymised when those options are enabled (§8.4, §10.7).
 */
export function redactPath(inputPath: string, options: RedactionOptions): RedactedPath {
  const canonical = isAbsolute(inputPath) ? resolve(inputPath) : resolve(process.cwd(), inputPath);
  const pathHash = sha256(`path:${canonical}`);

  let redactedPath: string | undefined = canonical;

  if (options.anonymiseRepoPath && options.repoPath) {
    const repo = options.repoPath;
    const rel = relative(repo, canonical);
    if (rel && !rel.startsWith("..")) {
      redactedPath = `[REPO]/${rel.split(sep).join("/")}`;
    } else {
      redactedPath = redactHome(canonical, options);
    }
  } else if (options.redactHomePath && options.homePath) {
    redactedPath = redactHome(canonical, options);
  }

  return { redactedPath, pathHash };
}

function redactHome(path: string, options: RedactionOptions): string {
  if (!options.redactHomePath || !options.homePath) return path;
  const home = options.homePath;
  if (path === home) return "[HOME]";
  if (path.startsWith(home + sep) || path.startsWith(home + "/")) {
    return `[HOME]${path.slice(home.length)}`;
  }
  return path;
}

export interface RedactedCommand {
  /** Redacted command text (secrets and home/repo paths replaced). */
  redactedCommand: string;
  /** Stable hash of the normalised command, for repetition detection (§10.8). */
  normalisedHash: string;
}

/**
 * Redact a shell command and produce a stable normalised hash. Normalisation
 * collapses volatile whitespace and lowercases the executable, so the same
 * command repeated yields the same hash while secrets are redacted away.
 */
export function redactCommand(raw: string, options: RedactionOptions): RedactedCommand {
  const { redacted } = redactInPlace(raw, options);
  const normalised = normaliseCommand(redacted);
  return {
    redactedCommand: redacted.trim(),
    normalisedHash: sha256(`cmd:${normalised}`),
  };
}

function normaliseCommand(cmd: string): string {
  return cmd.trim().replace(/\s+/g, " ").toLowerCase();
}

function redactInPlace(text: string, options: RedactionOptions): { redacted: string } {
  return { redacted: redactText(text, options).redacted };
}
