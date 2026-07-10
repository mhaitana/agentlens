/**
 * @agentlens/redaction — secret/path/command redaction (spec §8.4).
 *
 * Redaction must occur before database persistence and before logging. This
 * package is pure (no I/O) so callers can run it at any boundary.
 */

export {
  redactText,
  compileCustomPatterns,
  secretHash,
  type RedactionOptions,
  type CustomDetector,
  type RedactionFinding,
  type RedactionResult,
} from "./redact.js";

export { redactPath, redactCommand, type RedactedPath, type RedactedCommand } from "./paths.js";

export { DETECTORS, EMAIL_DETECTOR, type Detector } from "./detectors.js";
