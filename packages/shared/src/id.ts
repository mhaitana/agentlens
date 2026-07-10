import { randomUUID } from "node:crypto";

/** RFC 4122 v4 UUID. Used for entity IDs that do not need to be stable. */
export function randomId(): string {
  return randomUUID();
}

/** Short, lowercase, unambiguous id (first 12 hex chars of a UUID). */
export function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}
