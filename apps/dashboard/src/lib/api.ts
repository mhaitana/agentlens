/**
 * Typed API client for the local AgentLens API (spec).
 *
 * The dashboard is served *same-origin* by the local API, which injects a
 * runtime bootstrap into index.html:
 *
 *   window.__AGENTLENS__ = { apiBase: "/api/v1", token: "<runtime-token>" }
 *
 * Every mutating request carries `X-AgentLens-Token`. The token is
 * only readable by same-origin JS, so cross-origin pages cannot mutate. Read
 * requests are not token-gated, but the API restricts `Origin` to loopback
 *. If the bootstrap is missing (e.g. opened as a static file) we fail
 * loudly rather than silently degrading — the dashboard needs the API.
 *
 * The dashboard consumes *only* these normalised view types — never raw
 * Claude transcript shapes.
 */

/** Bootstrap injected by the local API into index.html at serve time. */
interface AgentLensBootstrap {
  apiBase: string;
  token: string;
}

declare global {
  interface Window {
    __AGENTLENS__?: AgentLensBootstrap;
  }
}

function bootstrap(): AgentLensBootstrap {
  const b = window.__AGENTLENS__;
  if (!b || !b.apiBase || !b.token) {
    throw new Error(
      "AgentLens API bootstrap missing. Run `agentlens dashboard` to serve the dashboard via the local API.",
    );
  }
  return b;
}

let cached: AgentLensBootstrap | null = null;
function cfg(): AgentLensBootstrap {
  if (!cached) cached = bootstrap();
  return cached;
}

/** Base URL for API calls (resolved once). */
export function apiBase(): string {
  return cfg().apiBase;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${cfg().apiBase}${path}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";

  // Mutating methods require the runtime token.
  if (method !== "GET") headers["x-agentlens-token"] = cfg().token;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(0, "network", `Could not reach the local API at ${url}`, String(e));
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const err = parsed as { code?: string; message?: string; details?: unknown } | null;
    throw new ApiError(
      res.status,
      err?.code ?? "http_error",
      err?.message ?? `HTTP ${res.status}`,
      err?.details,
    );
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

export { ApiError };
