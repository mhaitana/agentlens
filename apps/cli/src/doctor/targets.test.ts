/**
 * Approved-path allowlist for the Configuration Doctor (spec §19.2).
 *
 * Verifies the hard security boundary: Doctor writes/restores are confined to
 * the Claude home (`~/.claude`) or a project's CLAUDE.md / .mcp.json / .claude
 * directory. Request-supplied paths are canonicalised, and a target outside the
 * allowlist is refused.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { isApprovedConfigTarget, canonicaliseInputPath, isPathWithin } from "./targets.js";

const CLAUDE_HOME = join("/home/u", ".claude");
const PROJECT = join("/home/u", "projects", "app");

describe("isApprovedConfigTarget (§19.2)", () => {
  it("allows files under the Claude home", () => {
    expect(isApprovedConfigTarget(join(CLAUDE_HOME, "settings.json"), CLAUDE_HOME)).toBe(true);
    expect(isApprovedConfigTarget(join(CLAUDE_HOME, "hooks", "x.js"), CLAUDE_HOME)).toBe(true);
    expect(isApprovedConfigTarget(CLAUDE_HOME, CLAUDE_HOME)).toBe(true);
  });

  it("allows a project's CLAUDE.md, .mcp.json, and .claude/ — nothing else under the project", () => {
    expect(isApprovedConfigTarget(join(PROJECT, "CLAUDE.md"), CLAUDE_HOME, PROJECT)).toBe(true);
    expect(isApprovedConfigTarget(join(PROJECT, ".mcp.json"), CLAUDE_HOME, PROJECT)).toBe(true);
    expect(
      isApprovedConfigTarget(join(PROJECT, ".claude", "rules", "x.md"), CLAUDE_HOME, PROJECT),
    ).toBe(true);
    // A random source file under the project is NOT an approved config target.
    expect(isApprovedConfigTarget(join(PROJECT, "src", "index.ts"), CLAUDE_HOME, PROJECT)).toBe(
      false,
    );
    expect(isApprovedConfigTarget(join(PROJECT, "package.json"), CLAUDE_HOME, PROJECT)).toBe(false);
  });

  it("refuses targets outside both roots", () => {
    expect(isApprovedConfigTarget("/etc/passwd", CLAUDE_HOME)).toBe(false);
    expect(isApprovedConfigTarget(join("/etc", "CLAUDE.md"), CLAUDE_HOME)).toBe(false);
    expect(isApprovedConfigTarget(join("/home/u", ".ssh", "id_rsa"), CLAUDE_HOME, PROJECT)).toBe(
      false,
    );
  });

  it("refuses traversal that escapes via .. (canonicalised before the check)", () => {
    // /home/u/.claude/../../etc/x -> /etc/x after resolve, which is outside.
    const escaping = join(CLAUDE_HOME, "..", "..", "etc", "x");
    expect(isApprovedConfigTarget(escaping, CLAUDE_HOME)).toBe(false);
    // A project path that tries to climb out of the project root.
    const climb = join(PROJECT, "..", "..", "secret", "CLAUDE.md");
    expect(isApprovedConfigTarget(climb, CLAUDE_HOME, PROJECT)).toBe(false);
  });

  it("refuses undefined / empty targets", () => {
    expect(isApprovedConfigTarget(undefined, CLAUDE_HOME)).toBe(false);
    expect(isApprovedConfigTarget("", CLAUDE_HOME)).toBe(false);
  });
});

describe("canonicaliseInputPath (§19.2)", () => {
  it("returns undefined for empty / whitespace / relative paths", () => {
    expect(canonicaliseInputPath(undefined)).toBeUndefined();
    expect(canonicaliseInputPath("")).toBeUndefined();
    expect(canonicaliseInputPath("   ")).toBeUndefined();
    expect(canonicaliseInputPath("relative/path")).toBeUndefined();
  });

  it("canonicalises absolute paths", () => {
    expect(canonicaliseInputPath("/home/u/.claude/")).toBe(join("/home/u", ".claude"));
    expect(canonicaliseInputPath("/home/u/../u/projects/app")).toBe(
      join("/home/u", "projects", "app"),
    );
  });
});

describe("isPathWithin (§19.2)", () => {
  it("treats a child and the root itself as within", () => {
    expect(isPathWithin(join(PROJECT, "CLAUDE.md"), PROJECT)).toBe(true);
    expect(isPathWithin(PROJECT, PROJECT)).toBe(true);
  });

  it("rejects siblings and escapes", () => {
    expect(isPathWithin(join(PROJECT, "..", "secret"), PROJECT)).toBe(false);
    expect(isPathWithin("/etc", PROJECT)).toBe(false);
  });
});
