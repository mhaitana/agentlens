import { readFile, writeFile } from "node:fs/promises";
import {
  AgentLensConfig,
  defaultConfig,
  CURRENT_CONFIG_VERSION,
  type AgentLensConfig as Config,
} from "./schema.js";
import { configPath, ensureDataDirs } from "./paths.js";

/** Outcome of validating raw config. */
export interface ValidationResult {
  ok: boolean;
  config?: Config;
  errors: string[];
}

/**
 * Migrate a raw parsed config to the current version. For now only version 1
 * exists; missing version is treated as a fresh config (§9: migrate safely).
 * Unknown future-compatible keys are preserved via passthrough schemas.
 */
export function migrate(raw: unknown): Config {
  if (raw === null || typeof raw !== "object") {
    return defaultConfig();
  }
  const obj = raw as Record<string, unknown>;
  const version = typeof obj.version === "number" ? obj.version : CURRENT_CONFIG_VERSION;

  if (version === CURRENT_CONFIG_VERSION) {
    const result = AgentLensConfig.safeParse(obj);
    return result.success ? (result.data as Config) : mergeWithDefaults(obj);
  }

  // Future migrations would go here, stepping version-by-version.
  return mergeWithDefaults(obj);
}

/** Validate raw config; returns diagnostics without throwing. */
export function validate(raw: unknown): ValidationResult {
  const result = AgentLensConfig.safeParse(raw);
  if (result.success) {
    return { ok: true, config: result.data as Config, errors: [] };
  }
  const errors = result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`);
  return { ok: false, errors };
}

/** Merge unknown/invalid fields over a full default config so a partial file
 *  still yields a usable config. */
function mergeWithDefaults(obj: Record<string, unknown>): Config {
  const base = defaultConfig();
  return {
    ...base,
    ...obj,
    privacy: { ...base.privacy, ...((obj.privacy as object) ?? {}) },
    sources: {
      ...base.sources,
      claudeCode: {
        ...base.sources.claudeCode,
        ...(((obj.sources as Record<string, unknown> | undefined)?.claudeCode as object) ?? {}),
      },
    },
    analysis: { ...base.analysis, ...((obj.analysis as object) ?? {}) },
    dashboard: { ...base.dashboard, ...((obj.dashboard as object) ?? {}) },
    externalAnalysis: {
      ...base.externalAnalysis,
      ...((obj.externalAnalysis as object) ?? {}),
    },
    version: CURRENT_CONFIG_VERSION,
  } as Config;
}

/** Load config from the data home, creating a default if absent. */
export async function loadConfig(home: string): Promise<Config> {
  const path = configPath(home);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    // No config yet — write a default and return it.
    const cfg = defaultConfig();
    await saveConfig(home, cfg);
    return cfg;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt JSON — fall back to defaults (do not lose the file).
    return defaultConfig();
  }
  return migrate(parsed);
}

/** Save config to the data home, ensuring the directory exists. */
export async function saveConfig(home: string, config: Config): Promise<void> {
  await ensureDataDirs(home);
  const path = configPath(home);
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}

/** Get a nested value by dot path, e.g. "privacy.mode". Returns undefined if
 *  any segment is missing. */
export function getConfigValue(config: Config, key: string): unknown {
  const segments = key.split(".");
  let current: unknown = config;
  for (const seg of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/** Set a nested value by dot path and return a new validated config. Throws if
 *  the resulting config fails validation. */
export function setConfigValue(config: Config, key: string, value: unknown): Config {
  const next = structuredClone(config) as Record<string, unknown>;
  const segments = key.split(".");
  let current: Record<string, unknown> = next;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i] as string;
    const child = current[seg];
    if (child === null || typeof child !== "object") {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }
  const last = segments[segments.length - 1] as string;
  // Coerce simple scalar strings to numbers/booleans for CLI `config set`.
  current[last] = coerce(value);

  const result = validate(next);
  if (!result.ok || !result.config) {
    throw new Error(`Invalid config after setting "${key}": ${result.errors.join("; ")}`);
  }
  return result.config;
}

function coerce(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}
