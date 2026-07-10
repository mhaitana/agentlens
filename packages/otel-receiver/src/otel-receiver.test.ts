/**
 * OTLP receiver tests (spec §14.6, §14.11).
 *
 * OTLP/JSON metrics + logs are ingested and deduped; malformed JSON is rejected
 * (400); protobuf / wrong content-type is rejected (415); oversized bodies are
 * rejected safely; the receiver is loopback-only and redacts before persist.
 */
import { describe, it, expect } from "vitest";
import { rm } from "node:fs/promises";
import { openDatabase, closeDatabase } from "@agentlens/database";
import { defaultConfig } from "@agentlens/config";
import { parseOtlpJson } from "./parse.js";
import { OtelEventRepo } from "./repo.js";
import { buildOtelReceiver, startOtelReceiver } from "./receiver.js";

const NOW = "2026-07-10T12:00:00.000Z";

async function withDb<T>(
  fn: (db: Awaited<ReturnType<typeof openDatabase>>) => Promise<T>,
): Promise<T> {
  const database = await openDatabase({ home: "", nowIso: NOW, inMemory: true });
  try {
    return await fn(database);
  } finally {
    await closeDatabase(database);
    await Promise.all([
      rm(database.path, { force: true }),
      rm(`${database.path}-wal`, { force: true }),
      rm(`${database.path}-shm`, { force: true }),
    ]);
  }
}

describe("parseOtlpJson (§14.8 tolerant)", () => {
  it("parses OTLP/JSON metrics with resource + scope nesting", () => {
    const body = JSON.stringify({
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: "session.id", value: { stringValue: "claude-1" } }],
          },
          scopeMetrics: [
            {
              metrics: [
                { name: "claude_code.token.usage", unit: "tokens", gauge: { value: 42 } },
                { name: "claude_code.api.duration", unit: "ms" },
              ],
            },
          ],
        },
      ],
    });
    const r = parseOtlpJson("metric", body);
    expect(r.records.length).toBe(2);
    const first = r.records[0];
    expect(first?.name).toBe("claude_code.token.usage");
    expect(first?.sourceSessionId).toBe("claude-1");
  });

  it("parses logs and skips malformed records", () => {
    const body = JSON.stringify({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                { timeUnixNano: "1750000000000000000", body: { stringValue: "hi" } },
                null,
                { timeUnixNano: "1750000001000000000", body: { stringValue: "ok" } },
              ],
            },
          ],
        },
      ],
    });
    const r = parseOtlpJson("log", body);
    expect(r.records.length).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.records[0]?.timestamp).toContain("2025");
  });

  it("parses traces (spans) with names + start time", () => {
    const body = JSON.stringify({
      resourceSpans: [
        {
          scopeSpans: [
            { spans: [{ name: "tool.exec", startTimeUnixNano: "1750000000000000000" }] },
          ],
        },
      ],
    });
    const r = parseOtlpJson("trace", body);
    expect(r.records.length).toBe(1);
    expect(r.records[0]?.name).toBe("tool.exec");
  });

  it("returns a diagnostic on invalid JSON", () => {
    const r = parseOtlpJson("metric", "not json {{{");
    expect(r.records).toEqual([]);
    expect(r.diagnostics[0]).toContain("not valid JSON");
  });
});

describe("OTLP receiver HTTP (§14.6, §14.11)", () => {
  it("ingests metrics + logs and dedups retransmissions", async () => {
    await withDb(async (database) => {
      const app = await buildOtelReceiver({ db: database.db, config: defaultConfig() });
      try {
        const metrics = JSON.stringify({
          resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: "claude_code.token.usage" }] }] }],
        });
        const inject = (path: string, body: unknown) =>
          app.inject({
            method: "POST",
            url: path,
            headers: { "content-type": "application/json" },
            body,
          });

        const r1 = await inject("/v1/metrics", metrics);
        expect(r1.statusCode).toBe(201);
        expect(JSON.parse(r1.body).inserted).toBe(1);

        // Retransmission → deduped, 200.
        const r2 = await inject("/v1/metrics", metrics);
        expect(r2.statusCode).toBe(200);
        expect(JSON.parse(r2.body).deduped).toBe(1);
        expect(JSON.parse(r2.body).inserted).toBe(0);

        const logs = JSON.stringify({
          resourceLogs: [{ scopeLogs: [{ logRecords: [{ body: { stringValue: "x" } }] }] }],
        });
        const r3 = await inject("/v1/logs", logs);
        expect(r3.statusCode).toBe(201);

        const repo = new OtelEventRepo(database.db);
        expect(await repo.total()).toBe(2);
        expect(await repo.totalByKind("metric")).toBe(1);
        expect(await repo.totalByKind("log")).toBe(1);
      } finally {
        await app.close();
      }
    });
  });

  it("rejects protobuf / wrong content-type with 415 (guidance)", async () => {
    await withDb(async (database) => {
      const app = await buildOtelReceiver({ db: database.db, config: defaultConfig() });
      try {
        const r = await app.inject({
          method: "POST",
          url: "/v1/metrics",
          headers: { "content-type": "application/x-protobuf" },
          body: "\x0a\x02\x01\x02",
        });
        expect(r.statusCode).toBe(415);
        expect(r.body).toContain("http/json");
      } finally {
        await app.close();
      }
    });
  });

  it("rejects malformed JSON with 400", async () => {
    await withDb(async (database) => {
      const app = await buildOtelReceiver({ db: database.db, config: defaultConfig() });
      try {
        // Non-JSON body must still be parsed by Fastify; send raw text via buffer.
        const r = await app.inject({
          method: "POST",
          url: "/v1/metrics",
          headers: { "content-type": "application/json" },
          body: Buffer.from("not json {{{"),
        });
        expect(r.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });
  });

  it("binds to loopback and serves health/ready", async () => {
    await withDb(async (database) => {
      const receiver = await startOtelReceiver({ db: database.db, config: defaultConfig() });
      try {
        expect(receiver.host).toBe("127.0.0.1");
        const health = await fetch(`http://127.0.0.1:${receiver.port}/health`);
        expect(health.ok).toBe(true);
        const ready = await fetch(`http://127.0.0.1:${receiver.port}/ready`);
        expect(ready.ok).toBe(true);
      } finally {
        await receiver.close();
      }
    });
  });

  it("rejects oversized bodies safely (§14.11)", async () => {
    await withDb(async (database) => {
      const app = await buildOtelReceiver({
        db: database.db,
        config: defaultConfig(),
        bodyLimit: 64,
      });
      try {
        const big = JSON.stringify({
          resourceMetrics: [
            { scopeMetrics: [{ metrics: [{ name: "x", big: "A".repeat(10_000) }] }] },
          ],
        });
        const r = await app.inject({
          method: "POST",
          url: "/v1/metrics",
          headers: { "content-type": "application/json" },
          body: big,
        });
        expect(r.statusCode).toBe(413);
      } finally {
        await app.close();
      }
    });
  });
});
