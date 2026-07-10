/**
 * Security middleware (spec §17, §19.1).
 *
 * Loopback-only binding is enforced by the launcher (`host: "127.0.0.1"`).
 * Here we add the request-time protections:
 *
 * - **Runtime token.** Mutating methods (POST/PUT/PATCH/DELETE) require an
 *   `X-AgentLens-Token` header equal to the generated runtime token. The token
 *   is injected into the same-origin dashboard's HTML, so only same-origin JS
 *   can read it; cross-origin pages cannot (§17 "local runtime token").
 * - **Origin restriction.** For browser requests carrying an `Origin` header,
 *   only loopback origins are accepted. This blocks DNS-rebinding and
 *   cross-origin browser abuse (§19.1, §17 "restrict allowed origins").
 * - **No permissive CORS.** We never set `Access-Control-Allow-Origin: *`; the
 *   default same-origin policy therefore blocks cross-origin reads.
 */
import type { FastifyInstance } from "fastify";

/** Loopback hostnames considered same-origin (IPv4 + IPv6 + hostname). */
const LOOPBACK_ORIGINS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** True for methods that mutate state and so require the runtime token. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Extract the origin host from an `Origin` / `Referer` header. Returns the
 * lowercase host (without port) or undefined when the header is absent.
 */
function originHost(headerValue: string | string[] | undefined): string | undefined {
  if (!headerValue) return undefined;
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!value) return undefined;
  const match = /^https?:\/\/([^/]+)/i.exec(value);
  if (!match) return undefined;
  const group = match[1];
  if (!group) return undefined;
  let host = group.toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end > 0 ? host.slice(0, end + 1) : host;
  } else if (host.includes(":")) {
    host = host.slice(0, host.indexOf(":"));
  }
  return host;
}

/** Install the runtime-token + origin checks on a Fastify instance. */
export function installSecurity(app: FastifyInstance, runtimeToken: string): void {
  app.addHook("onRequest", async (req, reply) => {
    // --- Origin restriction (all browser requests that name an origin) ---
    const host = originHost(req.headers.origin) ?? originHost(req.headers.referer);
    if (host !== undefined && !LOOPBACK_ORIGINS.has(host)) {
      reply.code(403).send({ code: "forbidden", message: "Origin not allowed." });
      return;
    }

    // --- Runtime token (mutating methods only) ---
    if (MUTATING_METHODS.has(req.method.toUpperCase())) {
      const provided = req.headers["x-agentlens-token"];
      if (typeof provided !== "string" || provided.length === 0) {
        reply.code(401).send({ code: "unauthorized", message: "Missing runtime token." });
        return;
      }
      if (!constantTimeEqual(provided, runtimeToken)) {
        reply.code(403).send({ code: "forbidden", message: "Invalid runtime token." });
        return;
      }
    }
  });
}

/** Constant-time string comparison (avoids timing-based token probing). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
