import { homedir } from "node:os";
import type { PrivacyMode } from "@agentlens/config";
import {
  compileCustomPatterns,
  type CustomDetector,
  type RedactionOptions,
} from "@agentlens/redaction";

/**
 * Privacy context used by the import pipeline (spec §8.1–8.4).
 *
 * Secret detection ALWAYS runs (even in full-local, secrets are never
 * persisted). The mode controls whether content/paths/commands are stored at
 * all, and whether home/repo paths are anonymised when they are.
 */
export interface ImportPrivacy {
  mode: PrivacyMode;
  /** Whether any prompt content / file paths / command text is stored. */
  storeContent: boolean;
  /** Compiled redaction options applied to stored text. */
  options: RedactionOptions;
}

export interface BuildPrivacyInput {
  mode: PrivacyMode;
  redactEmails: boolean;
  redactHomePath: boolean;
  customPatterns: Array<{ name: string; pattern: string; replacement: string }>;
  /** The repository/project root, for path anonymisation. */
  repoPath?: string;
}

/** Build an {@link ImportPrivacy} from the loaded config + runtime context. */
export function buildPrivacy(input: BuildPrivacyInput): ImportPrivacy {
  const storeContent = input.mode !== "metadata-only";
  // In redacted-content mode we anonymise home + repo paths. In full-local we
  // keep paths (but still strip secrets via the always-on detectors).
  const anonymiseRepoPath = input.mode === "redacted-content";
  const redactHomePath = input.mode === "redacted-content" ? true : input.redactHomePath;

  const custom: CustomDetector[] = compileCustomPatterns(input.customPatterns);

  return {
    mode: input.mode,
    storeContent,
    options: {
      redactEmails: input.redactEmails,
      redactHomePath,
      homePath: homedir(),
      repoPath: input.repoPath,
      anonymiseRepoPath,
      customPatterns: custom,
    },
  };
}
