/**
 * Minimal OpenAI-compatible chat-completions client used by the external
 * CoachingProvider implementations (spec §15.5). Both the `openai-compatible`
 * provider and the `local-model` provider (Ollama / LM Studio, which expose the
 * same `/v1/chat/completions` shape) use it.
 *
 * Privacy (§15.5, §3.2):
 * - Only the already-redacted prompt text and structural features are sent —
 *   never a transcript. The gateway redacts before calling.
 * - The API key is read from the environment by the caller and passed in here
 *   only for the duration of the request; it is never logged or persisted.
 * - `fetch` is injectable so tests never touch the network.
 */

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatCompletionOptions {
  /** Base URL, e.g. `https://api.openai.com/v1` or `http://127.0.0.1:11434/v1`. */
  endpoint: string;
  model: string;
  /** Bearer token; omitted for the local-model provider (no key). */
  apiKey?: string;
  /** Injected fetch (tests); defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request cancellation (§15.5 step 5). */
  signal?: AbortSignal;
  /** Request timeout in ms (default 30 000). */
  timeoutMs?: number;
}

/** POST a chat completion and return the assistant message text. */
export async function chatCompletion(
  messages: ChatMessage[],
  opts: ChatCompletionOptions,
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("No fetch implementation available for external coaching call.");
  }
  const url = `${opts.endpoint.replace(/\/$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

  const timeoutMs = opts.timeoutMs ?? 30_000;
  // Prefer the caller's cancel signal; otherwise apply a timeout. (Combining
  // signals via AbortSignal.any is gated on runtime support, so we keep it
  // simple and let the caller layer its own timeout if it needs both.)
  const timeoutCtor = AbortSignal as unknown as {
    timeout?: (ms: number) => AbortSignal;
  };
  const signal: AbortSignal | undefined = opts.signal ?? timeoutCtor.timeout?.(timeoutMs);

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: 0,
        stream: false,
      }),
      signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw new Error("External coaching request cancelled.");
    throw new Error(`External coaching request failed: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(`External coaching endpoint returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("External coaching endpoint returned no message content.");
  }
  return content;
}

/**
 * Best-effort extraction of a JSON object from a model response, tolerating
 * ``` fenced code blocks and leading/trailing prose. Returns null on failure.
 */
export function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? (fenced[1] ?? content) : content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
