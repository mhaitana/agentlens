/**
 * @agentlens/shared — cross-package primitives with no internal dependencies.
 *
 * Kept dependency-free so it sits at the bottom of the package graph; every
 * other package may depend on it but it depends on nothing internal.
 */

export { sha256, hashObject, stableStringify } from "./hash.js";
export { randomId, shortId } from "./id.js";
export { assertNever } from "./types.js";

export type { Branded, Result, Ok, Err } from "./types.js";
