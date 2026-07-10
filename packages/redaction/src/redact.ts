import { sha256 } from "@agentlens/shared";
import { DETECTORS, EMAIL_DETECTOR, type Detector } from "./detectors.js";

/** Options controlling redaction. */
export interface RedactionOptions {
  redactEmails: boolean;
  /** Redact the user's home-directory prefix in paths/text. */
  redactHomePath: boolean;
  /** Absolute home path to redact (required when redactHomePath is true). */
  homePath?: string;
  /** Repository path to anonymise (optional, §8.4). */
  repoPath?: string;
  /** Whether to anonymise the repository path. */
  anonymiseRepoPath: boolean;
  /** User-defined patterns (compiled from config). */
  customPatterns?: CustomDetector[];
}

export interface CustomDetector {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/** One observed redaction category with its occurrence count. */
export interface RedactionFinding {
  category: string;
  label: string;
  count: number;
}

export interface RedactionResult {
  redacted: string;
  findings: RedactionFinding[];
  /** Stable hash of the redacted text (safe to persist; no secret included). */
  hash: string;
}

/** A per-secret correlation hash (one-way; never the original value). */
export function secretHash(value: string): string {
  return sha256(`secret:${value}`);
}

function applyDetector(
  text: string,
  detector: Detector,
  counts: Map<string, RedactionFinding>,
): string {
  const label = detector.label;
  const category = detector.category;
  return text.replace(detector.pattern, () => {
    bump(counts, category, label);
    // Replace with a labelled placeholder. Using a function avoids `$`
    // interpretation issues present in the matched value.
    return `[REDACTED:${label}]`;
  });
}

function bump(counts: Map<string, RedactionFinding>, category: string, label: string): void {
  const existing = counts.get(category);
  if (existing) {
    existing.count += 1;
  } else {
    counts.set(category, { category, label, count: 1 });
  }
}

/** Redact secrets from arbitrary text. Order: built-in detectors → email →
 *  custom patterns → path redaction. */
export function redactText(text: string, options: RedactionOptions): RedactionResult {
  const counts = new Map<string, RedactionFinding>();
  let out = text;

  for (const detector of DETECTORS) {
    out = applyDetector(out, detector, counts);
  }

  if (options.redactEmails) {
    out = applyDetector(out, EMAIL_DETECTOR, counts);
  }

  if (options.customPatterns) {
    for (const custom of options.customPatterns) {
      out = out.replace(custom.pattern, () => {
        bump(counts, `custom:${custom.name}`, custom.name);
        return custom.replacement;
      });
    }
  }

  // Path redaction applied last so detector placeholders are not disturbed.
  if (options.redactHomePath && options.homePath) {
    out = redactHomeInText(out, options.homePath);
  }
  if (options.anonymiseRepoPath && options.repoPath) {
    out = out.split(options.repoPath).join("[REPO]");
  }

  return {
    redacted: out,
    findings: [...counts.values()],
    hash: sha256(out),
  };
}

function redactHomeInText(text: string, homePath: string): string {
  if (!homePath) return text;
  // Escape regex metacharacters in the home path.
  const escaped = homePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "g"), "[HOME]");
}

/** Combine a set of custom patterns from raw config into compiled detectors. */
export function compileCustomPatterns(
  raw: Array<{ name: string; pattern: string; replacement: string }>,
): CustomDetector[] {
  const compiled: CustomDetector[] = [];
  for (const entry of raw) {
    try {
      compiled.push({
        name: entry.name,
        pattern: new RegExp(entry.pattern, "g"),
        replacement: entry.replacement,
      });
    } catch {
      // Skip invalid user regex rather than failing redaction.
    }
  }
  return compiled;
}
