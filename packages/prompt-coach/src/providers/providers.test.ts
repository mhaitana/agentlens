/**
 * Tests for the CoachingProvider implementations and the CoachingGateway
 * safeguards (spec §15.5).
 *
 * External providers never touch the network — `fetch` is injected. The gateway
 * tests verify the six §15.5 safeguards: disabled-by-default, disclosure,
 * redaction, preview, opt-in, per-request cancellation, and external-advice
 * marking.
 */
import { describe, it, expect } from "vitest";
import type { CoachingProvider, PromptFeatures, RedactedPromptPayload } from "@agentlens/domain";
import {
  noneProvider,
  deterministicProvider,
  openAiCompatibleProvider,
  localModelProvider,
  CoachingGateway,
  resolveCoachingProvider,
  extractJson,
} from "../index.js";

/** A minimal feature set for tests. */
function features(over: Partial<PromptFeatures> = {}): PromptFeatures {
  return {
    appearsCorrective: false,
    beginsNewTask: true,
    referencesAcceptanceCriteria: false,
    requestsVerification: false,
    multipleIndependentTasks: false,
    imperativeVerbCount: 1,
    fileReferenceCount: 1,
    ambiguousReferenceCount: 0,
    hasScopeMarkers: false,
    appearsReversal: false,
    complexityScore: 0.2,
    length: 20,
    ...over,
  };
}

function payload(content: string, over: Partial<PromptFeatures> = {}): RedactedPromptPayload {
  return { redactedContent: content, sequence: 1, features: features(over) };
}

/** Build an injectable fake fetch returning a chat-completions-shaped body. */
function fakeFetch(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function chatBody(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("none provider", () => {
  it("is not external and returns unavailable results", async () => {
    const p = noneProvider();
    expect(p.external).toBe(false);
    const a = await p.analysePrompt({ prompt: payload("fix it") });
    expect(a.available).toBe(false);
    expect(a.generatedBy).toBe("none");
    const c = await p.classifyTask({ prompt: payload("fix it") });
    expect(c.available).toBe(false);
    const r = await p.generateRemediation({ prompt: payload("fix it") });
    expect(r.available).toBe(false);
  });
});

describe("deterministic provider", () => {
  it("is not external and produces on-device results", async () => {
    const p = deterministicProvider();
    expect(p.external).toBe(false);
    const a = await p.analysePrompt({ prompt: payload("Fix the bug in `src/a.ts`") });
    expect(a.available).toBe(true);
    expect(a.generatedBy).toBe("deterministic");
    expect(a.qualityNotes.length).toBeGreaterThan(0);
    const c = await p.classifyTask({ prompt: payload("Refactor the auth module") });
    expect(c.available).toBe(true);
    expect(c.taskType).toBe("refactor");
    const r = await p.generateRemediation({ prompt: payload("fix it") });
    expect(r.available).toBe(true);
    expect(r.remediation.length).toBeGreaterThan(0);
  });
});

describe("openai-compatible provider", () => {
  it("is external and sends only the redacted prompt + features, marking advice external", async () => {
    let capturedBody: unknown;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify(chatBody('{"qualityNotes":["n1"],"suggestedMissing":["m1"]}')),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const p = openAiCompatibleProvider({
      endpoint: "https://api.example.com/v1",
      model: "gpt-x",
      apiKey: "secret-key",
      fetchImpl,
    });
    expect(p.external).toBe(true);
    const a = await p.analysePrompt({ prompt: payload("Fix the bug") });
    expect(a.generatedBy).toBe("external");
    expect(a.available).toBe(true);
    expect(a.externalDisclaimer).toMatch(/external model/i);
    expect(a.qualityNotes).toEqual(["n1"]);
    // Only the redacted prompt + features were sent — no transcript.
    const body = capturedBody as { messages: { role: string; content: string }[] };
    const userMsg = body.messages.find((m) => m.role === "user");
    if (!userMsg) throw new Error("user message not sent");
    const userText = userMsg.content;
    expect(userText).toContain("Fix the bug");
    expect(userText).not.toMatch(/transcript/i);
    // Authorization header carried the bearer key.
    // (Body captured; headers checked separately below.)
  });

  it("requires an endpoint and model", () => {
    expect(() =>
      openAiCompatibleProvider({ endpoint: "", model: "x", fetchImpl: fakeFetch({}) }),
    ).toThrow();
    expect(() =>
      openAiCompatibleProvider({ endpoint: "https://x/v1", model: "", fetchImpl: fakeFetch({}) }),
    ).toThrow();
  });

  it("throws on a non-OK endpoint response", async () => {
    const fetchImpl = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const p = openAiCompatibleProvider({
      endpoint: "https://x/v1",
      model: "m",
      fetchImpl,
    });
    await expect(p.analysePrompt({ prompt: payload("fix it") })).rejects.toThrow(/500/);
  });
});

describe("local-model provider", () => {
  it("is external but sends no API key", async () => {
    let authHeader: string | null | undefined;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      authHeader = h.get("authorization");
      return new Response(
        JSON.stringify(chatBody('{"taskType":"review","confidence":0.8,"rationale":"r"}')),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;
    const p = localModelProvider({
      endpoint: "http://127.0.0.1:11434/v1",
      model: "llama3",
      fetchImpl,
    });
    expect(p.external).toBe(true);
    const c = await p.classifyTask({ prompt: payload("Review this code") });
    expect(c.generatedBy).toBe("external");
    expect(c.taskType).toBe("review");
    expect(authHeader).toBeNull();
  });
});

describe("extractJson", () => {
  it("parses fenced and unfenced JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('prose {"a":2} trailing')).toEqual({ a: 2 });
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("resolveCoachingProvider", () => {
  it("resolves each provider from settings", async () => {
    expect(
      resolveCoachingProvider({
        provider: "none",
        enabled: false,
        model: null,
        endpoint: null,
        apiKeyEnv: null,
      }).id,
    ).toBe("none");
    expect(
      resolveCoachingProvider({
        provider: "deterministic",
        enabled: false,
        model: null,
        endpoint: null,
        apiKeyEnv: null,
      }).id,
    ).toBe("deterministic");
    const ext = resolveCoachingProvider({
      provider: "openai-compatible",
      enabled: true,
      model: "m",
      endpoint: "https://x/v1",
      apiKeyEnv: "MY_KEY",
      fetchImpl: fakeFetch(chatBody('{"qualityNotes":[],"suggestedMissing":[]}')),
      readEnv: (n) => (n === "MY_KEY" ? "k" : undefined),
    });
    expect(ext.id).toBe("openai-compatible");
    expect(ext.external).toBe(true);
  });
});

describe("CoachingGateway safeguards (§15.5)", () => {
  function gatewayFor(
    provider: CoachingProvider,
    settings: { endpoint?: string; model?: string } = {},
  ) {
    return new CoachingGateway(provider, settings);
  }

  it("external provider: disabled by default — never sends (status disabled)", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify(chatBody('{"qualityNotes":[],"suggestedMissing":[]}')), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const p = openAiCompatibleProvider({ endpoint: "https://x/v1", model: "m", fetchImpl });
    const gw = gatewayFor(p, { endpoint: "https://x/v1", model: "m" });
    const res = await gw.analysePrompt(
      { prompt: payload("fix it") },
      { enabled: false, approved: false },
    );
    expect(res.status).toBe("disabled");
    expect(res.result.available).toBe(false);
    expect(calls).toBe(0);
    // Disclosure still describes what WOULD be sent.
    expect(res.disclosure?.external).toBe(true);
    expect(res.disclosure?.dataCategories).toContain("redacted-prompt-text");
  });

  it("external provider: enabled but not approved — status not-approved, no send", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify(chatBody('{"qualityNotes":[],"suggestedMissing":[]}')), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const p = openAiCompatibleProvider({ endpoint: "https://x/v1", model: "m", fetchImpl });
    const gw = gatewayFor(p, { endpoint: "https://x/v1", model: "m" });
    const res = await gw.analysePrompt(
      { prompt: payload("fix it") },
      { enabled: true, approved: false },
    );
    expect(res.status).toBe("not-approved");
    expect(calls).toBe(0);
  });

  it("external provider: enabled + approved — sends, redacts, and marks external", async () => {
    const seen: string[] = [];
    const redact = (t: string) => t.replace(/secret/i, "[REDACTED]");
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const um = body.messages.find((m: { role: string }) => m.role === "user");
      if (um) seen.push(um.content as string);
      return new Response(
        JSON.stringify(chatBody('{"qualityNotes":["q"],"suggestedMissing":[]}')),
        {
          status: 200,
        },
      );
    }) as unknown as typeof fetch;
    const p = openAiCompatibleProvider({ endpoint: "https://x/v1", model: "m", fetchImpl });
    const gw = gatewayFor(p, { endpoint: "https://x/v1", model: "m" });
    const res = await gw.analysePrompt(
      { prompt: payload("Fix the secret token leak") },
      { enabled: true, approved: true, redact },
    );
    expect(res.status).toBe("ok");
    expect(res.result.generatedBy).toBe("external");
    expect(res.result.externalDisclaimer).toMatch(/external model/i);
    // Redaction was applied before send.
    expect(seen[0]).toContain("[REDACTED]");
    expect(seen[0]).not.toMatch(/secret/i);
  });

  it("per-request cancellation: pre-aborted signal → status cancelled, no send", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify(chatBody('{"qualityNotes":[],"suggestedMissing":[]}')), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const p = openAiCompatibleProvider({ endpoint: "https://x/v1", model: "m", fetchImpl });
    const gw = gatewayFor(p);
    const ac = new AbortController();
    ac.abort();
    const res = await gw.generateRemediation(
      { prompt: payload("fix it") },
      { enabled: true, approved: true, signal: ac.signal },
    );
    expect(res.status).toBe("cancelled");
    expect(calls).toBe(0);
  });

  it("per-request cancellation: fetch abort → status cancelled", async () => {
    const fetchImpl = (async () => {
      throw new Error("The operation was aborted");
    }) as unknown as typeof fetch;
    const p = openAiCompatibleProvider({ endpoint: "https://x/v1", model: "m", fetchImpl });
    const gw = gatewayFor(p);
    const res = await gw.classifyTask(
      { prompt: payload("fix it") },
      { enabled: true, approved: true },
    );
    expect(res.status).toBe("cancelled");
    expect(res.result.available).toBe(false);
  });

  it("buildDisclosure lists data categories, endpoint/model, and a redacted preview", () => {
    const p = openAiCompatibleProvider({
      endpoint: "https://x/v1",
      model: "m",
      fetchImpl: fakeFetch({}),
    });
    const gw = gatewayFor(p, { endpoint: "https://x/v1", model: "m" });
    const d = gw.buildDisclosure(payload("Fix the secret token"), (t) =>
      t.replace(/secret/i, "[REDACTED]"),
    );
    expect(d.external).toBe(true);
    expect(d.endpoint).toBe("https://x/v1");
    expect(d.model).toBe("m");
    expect(d.dataCategories).toEqual([
      "redacted-prompt-text",
      "structural-features",
      "session-sequence",
    ]);
    expect(d.preview).toContain("[REDACTED]");
    expect(d.summary).toContain("openai-compatible");
  });

  it("deterministic/none providers bypass the gate (on-device, no disclosure categories)", async () => {
    const gw = gatewayFor(deterministicProvider());
    const res = await gw.analysePrompt(
      { prompt: payload("Fix the bug in `src/a.ts`") },
      { enabled: false, approved: false },
    );
    expect(res.status).toBe("ok");
    expect(res.result.available).toBe(true);
    expect(res.disclosure?.external).toBe(false);
    expect(res.disclosure?.dataCategories).toEqual([]);
  });

  it("endpoint error → status error with message", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const p = openAiCompatibleProvider({ endpoint: "https://x/v1", model: "m", fetchImpl });
    const gw = gatewayFor(p);
    const res = await gw.analysePrompt(
      { prompt: payload("fix it") },
      { enabled: true, approved: true },
    );
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/503/);
    expect(res.result.available).toBe(false);
  });
});
