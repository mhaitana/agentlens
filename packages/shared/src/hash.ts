import { createHash } from "node:crypto";

/**
 * SHA-256 hex digest of a string. Used to produce stable correlation hashes
 * (e.g. redacted-path hashes, normalised-command hashes) — never for secrets.
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Deterministic JSON serialisation: object keys are sorted so structurally
 * equal objects produce identical strings regardless of insertion order.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",");
  return `{${body}}`;
}

/**
 * Stable hash of any JSON-serialisable value. Useful for recommendation
 * fingerprints and dedup keys derived from structured evidence.
 */
export function hashObject(value: unknown): string {
  return sha256(stableStringify(value));
}
