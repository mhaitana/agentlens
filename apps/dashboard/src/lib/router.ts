/**
 * Minimal hash-based router (§13.9 navigation).
 *
 * Scope note (deviation from spec §5 which names TanStack Router): the
 * dashboard has a small, fixed set of screens and is served same-origin by the
 * local API. A dependency-free hash router keeps the bundle small and avoids
 * TanStack Router's file/code-based + type-safe-params ceremony, which is
 * disproportionate for a local 7-screen tool. Browser back/forward works via
 * the hash; the router is reactive via a tiny subscribe/notify store.
 */
import { useEffect, useSyncExternalStore } from "react";

export type RouteName =
  | "overview"
  | "sessions"
  | "session"
  | "projects"
  | "recommendations"
  | "coaching"
  | "doctor"
  | "privacy"
  | "onboarding"
  | "live";

export interface ParsedRoute {
  name: RouteName;
  /** For `session`: the session id. Otherwise empty. */
  params: Record<string, string>;
}

function parseHash(): ParsedRoute {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path = "", query = ""] = raw.split("?");
  const segs = path.split("/").filter(Boolean);
  const name = (segs[0] ?? "overview") as RouteName;
  const params: Record<string, string> = {};
  if (name === "session" && segs[1]) params.id = decodeURIComponent(segs[1]);
  if (query) {
    for (const pair of query.split("&")) {
      const [k, v = ""] = pair.split("=");
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }
  return { name, params };
}

let current: ParsedRoute = parseHash();
const listeners = new Set<() => void>();

function emit() {
  current = parseHash();
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", emit);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): ParsedRoute {
  return current;
}

/** Current route (reactive). */
export function useRoute(): ParsedRoute {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Navigate to a route. */
export function navigate(name: RouteName, params?: Record<string, string>): void {
  let hash = `#/${name}`;
  if (name === "session" && params?.id) hash += `/${encodeURIComponent(params.id)}`;
  // Remaining params (e.g. projectId on the sessions view) become a query string
  // that parseHash reads back, enabling deep links like #/sessions?projectId=p1.
  const query: string[] = [];
  for (const [k, v] of Object.entries(params ?? {})) {
    if (k === "id" && name === "session") continue;
    if (v !== undefined && v !== "")
      query.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  if (query.length > 0) hash += `?${query.join("&")}`;
  if (window.location.hash !== hash) window.location.hash = hash;
}

/** Ensure the hash reflects a default route on first load. */
export function useEnsureRoute(): void {
  useEffect(() => {
    if (!window.location.hash) window.location.hash = "#/overview";
  }, []);
}
