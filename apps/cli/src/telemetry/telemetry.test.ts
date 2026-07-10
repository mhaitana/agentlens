/**
 * Telemetry logic tests (spec §14.7, §14.11). Covers: minimal-config privacy
 * defaults, env-var construction, merge plan, Claude-settings env-block
 * write/remove with preservation of unrelated keys + backups. Uses temp dirs
 * for the Claude home (`AGENTLENS_CLAUDE_HOME`) — never the developer's real
 * `~/.claude` (§21).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@agentlens/config";
import {
  minimalTelemetryConfig,
  buildEnvVars,
  envVarsToShell,
  envVarsToUnset,
  telemetryMergePlan,
  applyConfigure,
  applyRemoveConfig,
  writeEnvToClaudeSettings,
  removeEnvFromClaudeSettings,
  claudeSettingsEnvState,
  claudeSettingsPath,
  resolveClaudeHome,
  AGENTLENS_OWNED_ENV_KEYS,
} from "./telemetry.js";

describe("telemetry config + env vars (§14.7, §14.11)", () => {
  it("minimal config disables every sensitive flag and traces by default", () => {
    const t = minimalTelemetryConfig();
    expect(t.enabled).toBe(true);
    expect(t.tracesEnabled).toBe(false);
    expect(t.logUserPrompts).toBe(false);
    expect(t.logAssistantResponses).toBe(false);
    expect(t.logToolDetails).toBe(false);
    expect(t.logToolContent).toBe(false);
    expect(t.logRawApiBodies).toBe(false);
    expect(t.protocol).toBe("http/json");
    expect(t.otlpPort).toBe(4318);
  });

  it("buildEnvVars emits required vars with sensitive flags off, traces=none", () => {
    const vars = buildEnvVars(minimalTelemetryConfig());
    const map = Object.fromEntries(vars.map((v) => [v.key, v.value]));
    expect(map["CLAUDE_CODE_ENABLE_TELEMETRY"]).toBe("1");
    expect(map["OTEL_METRICS_EXPORTER"]).toBe("otlp");
    expect(map["OTEL_LOGS_EXPORTER"]).toBe("otlp");
    expect(map["OTEL_TRACES_EXPORTER"]).toBe("none");
    expect(map["OTEL_EXPORTER_OTLP_PROTOCOL"]).toBe("http/json");
    expect(map["OTEL_EXPORTER_OTLP_ENDPOINT"]).toBe("http://127.0.0.1:4318");
    expect(map["OTEL_LOG_USER_PROMPTS"]).toBe("0");
    expect(map["OTEL_LOG_RAW_API_BODIES"]).toBe("0");
    expect(map["CLAUDE_CODE_ENHANCED_TELEMETRY_BETA"]).toBeUndefined();
  });

  it("livePort overrides the configured endpoint port", () => {
    const vars = buildEnvVars(minimalTelemetryConfig(), 5555);
    const map = Object.fromEntries(vars.map((v) => [v.key, v.value]));
    expect(map["OTEL_EXPORTER_OTLP_ENDPOINT"]).toBe("http://127.0.0.1:5555");
  });

  it("traces enabled adds the beta flag + otlp traces exporter", () => {
    const vars = buildEnvVars(minimalTelemetryConfig({ tracesEnabled: true }));
    const map = Object.fromEntries(vars.map((v) => [v.key, v.value]));
    expect(map["OTEL_TRACES_EXPORTER"]).toBe("otlp");
    expect(map["CLAUDE_CODE_ENHANCED_TELEMETRY_BETA"]).toBe("1");
  });

  it("disabled telemetry emits no env vars", () => {
    expect(buildEnvVars({ ...minimalTelemetryConfig(), enabled: false })).toEqual([]);
  });

  it("shell rendering produces export lines", () => {
    const vars = buildEnvVars(minimalTelemetryConfig());
    const sh = envVarsToShell(vars);
    expect(sh).toContain("export CLAUDE_CODE_ENABLE_TELEMETRY=1");
    expect(sh.split("\n").every((l) => l.startsWith("export "))).toBe(true);
  });

  it("merge plan marks the enabled change and sensitive flags as add", () => {
    const before = defaultConfig().telemetry; // enabled=false
    const after = minimalTelemetryConfig();
    const plan = telemetryMergePlan(before, after);
    const enabled = plan.find((e) => e.key === "enabled");
    expect(enabled?.change).not.toBe("none");
    const prompts = plan.find((e) => e.key === "logUserPrompts");
    expect(prompts?.sensitive).toBe(true);
  });

  it("applyConfigure/applyRemoveConfig swap the telemetry section", () => {
    const cfg = defaultConfig();
    const on = applyConfigure(cfg, minimalTelemetryConfig());
    expect(on.telemetry.enabled).toBe(true);
    const off = applyRemoveConfig(on);
    expect(off.telemetry.enabled).toBe(false);
  });
});

describe("telemetry Claude-settings env editing (§14.7, §14.11)", () => {
  let alHome: string;
  let claudeHome: string;

  beforeEach(() => {
    alHome = mkdtempSync(join(tmpdir(), "al-telem-"));
    claudeHome = mkdtempSync(join(tmpdir(), "al-telem-claude-"));
    process.env.AGENTLENS_CLAUDE_HOME = claudeHome;
  });
  afterEach(() => {
    delete process.env.AGENTLENS_CLAUDE_HOME;
    rmSync(alHome, { recursive: true, force: true });
    rmSync(claudeHome, { recursive: true, force: true });
  });

  it("writeEnvToClaudeSettings backs up + writes only AgentLens keys, preserves others", () => {
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(
      claudeSettingsPath(claudeHome),
      JSON.stringify({ env: { MY_OTHER_VAR: "x" }, hooks: { Stop: [] } }, null, 2),
    );
    const vars = buildEnvVars(minimalTelemetryConfig());
    const res = writeEnvToClaudeSettings(claudeHome, alHome, vars, false);
    expect(res.backedUp).not.toBeNull();
    expect(existsSync(res.backedUp as string)).toBe(true);
    const after = JSON.parse(readFileSync(claudeSettingsPath(claudeHome), "utf8"));
    expect(after.env["CLAUDE_CODE_ENABLE_TELEMETRY"]).toBe("1");
    expect(after.env["MY_OTHER_VAR"]).toBe("x"); // preserved
    expect(after.hooks).toEqual({ Stop: [] }); // preserved
  });

  it("write dry-run writes nothing", () => {
    const vars = buildEnvVars(minimalTelemetryConfig());
    const res = writeEnvToClaudeSettings(claudeHome, alHome, vars, true);
    expect(res.dryRun).toBe(true);
    expect(existsSync(claudeSettingsPath(claudeHome))).toBe(false);
  });

  it("removeEnvFromClaudeSettings removes only AgentLens keys, preserves others", () => {
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(
      claudeSettingsPath(claudeHome),
      JSON.stringify(
        {
          env: { CLAUDE_CODE_ENABLE_TELEMETRY: "1", MY_OTHER_VAR: "x", OTEL_LOGS_EXPORTER: "otlp" },
        },
        null,
        2,
      ),
    );
    const res = removeEnvFromClaudeSettings(claudeHome, alHome, false);
    expect(res.removedKeys).toContain("CLAUDE_CODE_ENABLE_TELEMETRY");
    expect(res.removedKeys).toContain("OTEL_LOGS_EXPORTER");
    expect(res.preservedKeys).toEqual(["MY_OTHER_VAR"]);
    const after = JSON.parse(readFileSync(claudeSettingsPath(claudeHome), "utf8"));
    expect(after.env["MY_OTHER_VAR"]).toBe("x");
    expect(after.env["CLAUDE_CODE_ENABLE_TELEMETRY"]).toBeUndefined();
  });

  it("owned key set is stable and covers the documented vars", () => {
    for (const required of [
      "CLAUDE_CODE_ENABLE_TELEMETRY",
      "OTEL_METRICS_EXPORTER",
      "OTEL_LOGS_EXPORTER",
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      "OTEL_LOG_USER_PROMPTS",
    ]) {
      expect(
        AGENTLENS_OWNED_ENV_KEYS.includes(required as (typeof AGENTLENS_OWNED_ENV_KEYS)[number]),
      ).toBe(true);
    }
  });

  it("claudeSettingsEnvState reports present vs other", () => {
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(
      claudeSettingsPath(claudeHome),
      JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TELEMETRY: "1", FOO: "bar" } }, null, 2),
    );
    const st = claudeSettingsEnvState(resolveClaudeHome());
    expect(st.present).toEqual(["CLAUDE_CODE_ENABLE_TELEMETRY"]);
    expect(st.other).toEqual(["FOO"]);
  });

  it("unset rendering covers the emitted keys", () => {
    const vars = buildEnvVars(minimalTelemetryConfig());
    const sh = envVarsToUnset(vars);
    expect(sh).toContain("unset CLAUDE_CODE_ENABLE_TELEMETRY");
    expect(sh).toContain("unset OTEL_EXPORTER_OTLP_ENDPOINT");
  });
});
