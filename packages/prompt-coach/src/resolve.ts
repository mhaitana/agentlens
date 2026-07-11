/**
 * Resolve a {@link CoachingProvider} from neutral coaching settings (spec
 * §15.5). The settings mirror `config.externalAnalysis` but are defined here
 * (not imported from the config package) so `@agentlens/prompt-coach` stays
 * decoupled from `@agentlens/config`; the CLI/API maps config → settings at the
 * call site.
 *
 * The API key for the openai-compatible provider is read from the environment
 * via the named variable (`apiKeyEnv`) — never from config — and only for the
 * duration of a request (§3.2: never persist API keys). `readEnv` is injectable
 * so tests never touch `process.env`.
 */
import type { CoachingProvider } from "@agentlens/domain";
import { deterministicProvider } from "./providers/deterministic.js";
import { localModelProvider, openAiCompatibleProvider } from "./providers/external.js";
import { noneProvider } from "./providers/none.js";

/** Neutral coaching settings (mirrors `config.externalAnalysis`). */
export interface CoachingProviderSettings {
  provider: "none" | "deterministic" | "openai-compatible" | "local-model";
  enabled: boolean;
  model: string | null;
  endpoint: string | null;
  /** Name of the env var holding the openai-compatible API key (not the key). */
  apiKeyEnv: string | null;
}

/** Dependencies for provider resolution (both injectable for tests). */
export interface ResolveCoachingProviderDeps {
  fetchImpl?: typeof fetch;
  readEnv?: (name: string) => string | undefined;
}

/** Default env reader: `process.env[name]` when available. */
function defaultReadEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env[name];
}

/**
 * Resolve a coaching provider from settings. External providers are constructed
 * regardless of `enabled` — the *enabled* gate is enforced by the
 * {@link CoachingGateway}, not here — but constructing one validates that an
 * endpoint + model are configured.
 */
export function resolveCoachingProvider(
  settings: CoachingProviderSettings,
  deps: ResolveCoachingProviderDeps = {},
): CoachingProvider {
  const readEnv = deps.readEnv ?? defaultReadEnv;
  switch (settings.provider) {
    case "none":
      return noneProvider();
    case "deterministic":
      return deterministicProvider();
    case "openai-compatible":
      return openAiCompatibleProvider({
        endpoint: settings.endpoint ?? "",
        model: settings.model ?? "",
        apiKey: settings.apiKeyEnv ? readEnv(settings.apiKeyEnv) : undefined,
        fetchImpl: deps.fetchImpl,
      });
    case "local-model":
      return localModelProvider({
        endpoint: settings.endpoint ?? "",
        model: settings.model ?? "",
        fetchImpl: deps.fetchImpl,
      });
  }
}
