import { describe, expect, it } from "vitest";
import { generateMcpToken, sha256Hex } from "../../src/server/auth/token-auth";
import { hasScope } from "../../src/server/auth/permissions";

describe("MCP token generation", () => {
  it("generates high-entropy nbk_ tokens", () => {
    const token = generateMcpToken();
    expect(token.startsWith("nbk_")).toBe(true);
    expect(token.length).toBeGreaterThan(40);
    const bytes = token.slice(4);
    expect(bytes).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique tokens", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateMcpToken());
    expect(seen.size).toBe(100);
  });

  it("hashes tokens with SHA-256 deterministically", async () => {
    const h1 = await sha256Hex("nbk_test");
    const h2 = await sha256Hex("nbk_test");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toContain("nbk_test");
    expect(await sha256Hex("nbk_test2")).not.toBe(h1);
  });

  it("never stores the raw token in the hash", async () => {
    const token = generateMcpToken();
    const hash = await sha256Hex(token);
    expect(hash).not.toContain(token.slice(4));
  });
});

describe("scope checks", () => {
  it("checks membership", () => {
    expect(hasScope(["read:issue", "write:issue"], "read:issue")).toBe(true);
    expect(hasScope(["read:issue"], "write:issue")).toBe(false);
    expect(hasScope([], "read:issue")).toBe(false);
  });
});
