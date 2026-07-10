/**
 * Cross-platform home-resolution tests (spec §7, §14.11: "Cross-platform path
 * and process behaviour is tested").
 *
 * `resolveAgentLensHome` branches on the OS: macOS →
 * `~/Library/Application Support/AgentLens`; Windows → `%LOCALAPPDATA%\AgentLens`;
 * Linux/other → `$XDG_DATA_HOME/agentlens` (or `~/.local/share/agentlens`).
 * `AGENTLENS_HOME` always wins. `node:os` is mocked so we can exercise every
 * branch regardless of the host running the suite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
  platform: () => "linux",
}));

// Import after the mock is registered so paths.ts picks up the mocked os.
const { resolveAgentLensHome } = await import("./paths.js");

const ORIG_ENV = { ...process.env };

describe("resolveAgentLensHome (§7 cross-platform)", () => {
  beforeEach(() => {
    delete process.env.AGENTLENS_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.LOCALAPPDATA;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(ORIG_ENV)) process.env[k] = v;
    // Static deletes only (no-dynamic-delete): clear the env keys we may have
    // set during a test if they weren't originally present.
    if (!("AGENTLENS_HOME" in ORIG_ENV)) delete process.env.AGENTLENS_HOME;
    if (!("XDG_DATA_HOME" in ORIG_ENV)) delete process.env.XDG_DATA_HOME;
    if (!("LOCALAPPDATA" in ORIG_ENV)) delete process.env.LOCALAPPDATA;
  });

  it("AGENTLENS_HOME override wins on every platform", () => {
    expect(resolveAgentLensHome("/custom/agentlens-home")).toBe("/custom/agentlens-home");
    process.env.AGENTLENS_HOME = "/env/override";
    expect(resolveAgentLensHome()).toBe("/env/override");
  });

  it("resolves the macOS path under ~/Library/Application Support", async () => {
    vi.doMock("node:os", () => ({ homedir: () => "/home/testuser", platform: () => "darwin" }));
    vi.resetModules();
    const mod = await import("./paths.js");
    expect(mod.resolveAgentLensHome()).toBe("/home/testuser/Library/Application Support/AgentLens");
    vi.doUnmock("node:os");
    vi.resetModules();
  });

  it("resolves the Windows path under %LOCALAPPDATA%", async () => {
    vi.doMock("node:os", () => ({ homedir: () => "/home/testuser", platform: () => "win32" }));
    vi.resetModules();
    process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
    const mod = await import("./paths.js");
    // node:path.join uses the host separator, so assert the base + leaf
    // rather than an exact string (the test host may be posix).
    const resolved = mod.resolveAgentLensHome();
    expect(resolved.startsWith("C:\\Users\\test\\AppData\\Local")).toBe(true);
    expect(resolved.endsWith("AgentLens")).toBe(true);
    vi.doUnmock("node:os");
    vi.resetModules();
  });

  it("resolves the Linux path under $XDG_DATA_HOME when set", () => {
    process.env.XDG_DATA_HOME = "/var/data";
    expect(resolveAgentLensHome()).toBe("/var/data/agentlens");
  });

  it("falls back to ~/.local/share/agentlens on Linux when XDG is unset", () => {
    expect(resolveAgentLensHome()).toBe("/home/testuser/.local/share/agentlens");
  });
});
