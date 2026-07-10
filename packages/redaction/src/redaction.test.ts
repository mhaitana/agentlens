import { describe, it, expect } from "vitest";
import {
  redactText,
  redactPath,
  redactCommand,
  compileCustomPatterns,
  secretHash,
} from "./index.js";

const baseOpts = {
  redactEmails: true,
  redactHomePath: false,
  anonymiseRepoPath: false,
};

describe("redactText — built-in detectors", () => {
  it("redacts a JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3ODkw.dozUyhDQyzVqkMlXQxJ0k";
    const { redacted, findings } = redactText(`token=${jwt}`, baseOpts);
    expect(redacted).not.toContain(jwt);
    expect(findings.some((f) => f.category === "jwt")).toBe(true);
  });

  it("redacts a GitHub token", () => {
    const tok = "ghp_012345678901234567890123456789012345";
    const { redacted } = redactText(`GH_TOKEN=${tok}`, baseOpts);
    expect(redacted).not.toContain(tok);
  });

  it("redacts a password assignment", () => {
    const { redacted, findings } = redactText("password=hunter2hunter2", baseOpts);
    expect(redacted).not.toContain("hunter2hunter2");
    expect(findings.some((f) => f.category === "password")).toBe(true);
  });

  it("redacts a connection string", () => {
    const cs = "postgres://user:secretpw@db.example.com:5432/app";
    const { redacted } = redactText(cs, baseOpts);
    expect(redacted).not.toContain("secretpw");
    expect(redacted).toContain("[REDACTED:connection-string]");
  });

  it("redacts a PEM private key block", () => {
    const key =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----";
    const { redacted } = redactText(key, baseOpts);
    expect(redacted).toContain("[REDACTED:private-key]");
    expect(redacted).not.toContain("MIIEowIBAAKCAQEA");
  });

  it("redacts emails when enabled and leaves them when disabled", () => {
    expect(redactText("contact a@b.com", baseOpts).redacted).toContain("[REDACTED:email]");
    expect(redactText("contact a@b.com", { ...baseOpts, redactEmails: false }).redacted).toContain(
      "a@b.com",
    );
  });

  it("preserves non-secret text unchanged", () => {
    const { redacted } = redactText("the quick brown fox", baseOpts);
    expect(redacted).toBe("the quick brown fox");
  });

  it("never leaks the original secret into findings (only category + count)", () => {
    const { findings } = redactText("password=hunter2hunter2", baseOpts);
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain("hunter2");
  });
});

describe("path redaction", () => {
  const opts = {
    redactEmails: false,
    redactHomePath: true,
    homePath: "/Users/example",
    anonymiseRepoPath: false,
  };

  it("produces a stable path hash regardless of home redaction", () => {
    const a = redactPath("/Users/example/projects/app/src/index.ts", opts);
    const b = redactPath("/Users/example/projects/app/src/index.ts", opts);
    expect(a.pathHash).toBe(b.pathHash);
  });

  it("redacts the home prefix", () => {
    const { redactedPath } = redactPath("/Users/example/projects/app/src/index.ts", opts);
    expect(redactedPath?.startsWith("[HOME]")).toBe(true);
    expect(redactedPath).not.toContain("/Users/example");
  });

  it("anonymises repo paths when enabled", () => {
    const o = { ...opts, anonymiseRepoPath: true, repoPath: "/Users/example/projects/app" };
    const { redactedPath } = redactPath("/Users/example/projects/app/src/index.ts", o);
    expect(redactedPath?.startsWith("[REPO]/")).toBe(true);
  });
});

describe("command redaction", () => {
  it("produces a stable normalised hash for equivalent commands", () => {
    const a = redactCommand("pnpm   test", baseOpts);
    const b = redactCommand("pnpm test", baseOpts);
    expect(a.normalisedHash).toBe(b.normalisedHash);
  });

  it("redacts secrets inside commands", () => {
    const { redactedCommand } = redactCommand(
      "export TOKEN=ghp_012345678901234567890123456789012345",
      baseOpts,
    );
    expect(redactedCommand).not.toContain("ghp_012345678901234567890123456789012345");
  });
});

describe("custom patterns", () => {
  it("applies user-defined regex with a custom label", () => {
    const compiled = compileCustomPatterns([
      { name: "ticket", pattern: "PROJ-\\d+", replacement: "[TICKET]" },
    ]);
    const { redacted, findings } = redactText("see PROJ-1234 for details", {
      ...baseOpts,
      customPatterns: compiled,
    });
    expect(redacted).toBe("see [TICKET] for details");
    expect(findings.some((f) => f.category === "custom:ticket")).toBe(true);
  });

  it("ignores invalid user regex", () => {
    const compiled = compileCustomPatterns([{ name: "bad", pattern: "(", replacement: "x" }]);
    expect(compiled).toHaveLength(0);
  });
});

describe("secretHash", () => {
  it("is one-way and stable", () => {
    expect(secretHash("abc")).toBe(secretHash("abc"));
    expect(secretHash("abc")).not.toBe("abc");
  });
});
