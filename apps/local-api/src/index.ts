/**
 * @agentlens/local-api — Fastify server exposing the local read/write API the
 * dashboard and CLI consume, plus the hook + OTLP ingestion endpoints (spec
 * §13.1). Bound to 127.0.0.1 only; never exposed on a public interface.
 *
 * INFRA-001 ships a minimal health-check surface; the full route tree arrives
 * in feature F008.
 */
import Fastify from "fastify";

async function main(): Promise<void> {
  const app = Fastify({ logger: false });

  app.get("/health", () => ({ status: "ok" }));

  const port = Number(process.env.AGENTLENS_API_PORT ?? 7474);
  await app.listen({ port, host: "127.0.0.1" });
  process.stdout.write(`AgentLens local API listening on 127.0.0.1:${port}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
