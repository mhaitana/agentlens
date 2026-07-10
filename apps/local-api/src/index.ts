/**
 * @agentlens/local-api — Fastify server exposing the local read/write API the
 * dashboard and CLI consume (spec §17). Bound to 127.0.0.1 only; never exposed
 * on a public interface (§19.1).
 *
 * Public surface:
 * - `buildServer(deps)` / `startServer(deps)` — create/run the API server.
 * - `generateRuntimeToken()` — random token guarding mutation endpoints.
 * - `pickFreePort(preferred)` — loopback port selection with occupied-port
 *   handling (§13.8), used by the `agentlens dashboard` command.
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

export type { ServerDeps, ApiError } from "./deps.js";
export { buildServer, startServer, type RunningServer } from "./server.js";
export { ApiHttpError, badRequest, notFound, forbidden } from "./errors.js";
export {
  LiveBus,
  buildLiveStatus,
  hookLiveEvent,
  otelLiveEvent,
  statusLiveEvent,
  heartbeatLiveEvent,
  type LiveEvent,
  type LiveListener,
  type LiveStatusDeps,
} from "./live.js";

/** Generate a random hex runtime token (§17, §19.1). */
export function generateRuntimeToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Return the preferred port if it is free on loopback; otherwise find and
 * return a free loopback port. Resolves with the chosen port (§13.8
 * "handle occupied ports safely").
 */
export async function pickFreePort(preferred: number): Promise<number> {
  const probe = (port: number) =>
    new Promise<boolean>((resolve) => {
      const s = createServer();
      s.unref();
      s.once("error", () => resolve(false));
      s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
    });
  // A concrete preferred port: use it if free, else fall back.
  if (preferred > 0 && (await probe(preferred))) return preferred;
  // 0 (or an occupied preferred) → let the OS assign a free loopback port.
  return new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => resolve(typeof addr === "object" && addr ? addr.port : preferred));
    });
  });
}
