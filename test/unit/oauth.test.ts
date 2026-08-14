/** Pure unit tests for OAuth protocol helpers (PKCE, tokens, validation). */
import { describe, expect, it } from "vitest";
import {
  base64urlEncode,
  isValidRedirectUri,
  parseScopes,
  pkceChallenge,
  randomToken,
  unionScopes,
  verifyPkce,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_AUTH_CODE_PREFIX,
  OAUTH_CLIENT_ID_PREFIX,
  OAUTH_REFRESH_TOKEN_PREFIX,
} from "../../src/server/services/oauth-service";
import { MCP_SCOPES } from "../../src/shared/limits";
import { OAuthError } from "../../src/server/services/oauth-service";

describe("OAuth credential generation", () => {
  it("generates high-entropy opaque credentials with distinct prefixes", () => {
    const access = randomToken(OAUTH_ACCESS_TOKEN_PREFIX);
    const refresh = randomToken(OAUTH_REFRESH_TOKEN_PREFIX);
    const code = randomToken(OAUTH_AUTH_CODE_PREFIX);
    const clientId = randomToken(OAUTH_CLIENT_ID_PREFIX);
    expect(access.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(refresh.startsWith(OAUTH_REFRESH_TOKEN_PREFIX)).toBe(true);
    expect(code.startsWith(OAUTH_AUTH_CODE_PREFIX)).toBe(true);
    expect(clientId.startsWith(OAUTH_CLIENT_ID_PREFIX)).toBe(true);
    for (const credential of [access, refresh, code, clientId]) {
      expect(credential.length).toBeGreaterThan(40);
      expect(credential).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("generates unique credentials", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(randomToken(OAUTH_ACCESS_TOKEN_PREFIX));
    expect(seen.size).toBe(200);
  });

  it("base64url-encodes without padding", () => {
    expect(base64urlEncode(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe("-__-");
    expect(base64urlEncode(new Uint8Array(0))).toBe("");
  });
});

describe("PKCE (RFC 7636 S256)", () => {
  it("derives deterministic S256 challenges", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await pkceChallenge(verifier);
    // Known test vector from RFC 7636 Appendix B.
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("verifies a correct verifier and rejects wrong ones", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await pkceChallenge(verifier);
    expect(await verifyPkce(verifier, challenge)).toBe(true);
    expect(await verifyPkce(`${verifier}x`, challenge)).toBe(false);
    expect(await verifyPkce("", challenge)).toBe(false);
    expect(await verifyPkce(verifier, "")).toBe(false);
  });

  it("rejects too-short or too-long verifiers", async () => {
    const challenge = await pkceChallenge("a".repeat(43));
    expect(await verifyPkce("short", challenge)).toBe(false);
    expect(await verifyPkce("a".repeat(200), challenge)).toBe(false);
  });
});

describe("redirect URI validation", () => {
  it("accepts https URIs", () => {
    expect(isValidRedirectUri("https://chatgpt.com/oauth/callback")).toBe(true);
    expect(isValidRedirectUri("https://nodebook.example.com/oauth/callback?x=1")).toBe(true);
  });

  it("accepts loopback http URIs only", () => {
    expect(isValidRedirectUri("http://localhost:8787/oauth/callback")).toBe(true);
    expect(isValidRedirectUri("http://127.0.0.1:3000/cb")).toBe(true);
    expect(isValidRedirectUri("http://[::1]:3000/cb")).toBe(true);
  });

  it("rejects insecure, malformed, or ambiguous URIs", () => {
    expect(isValidRedirectUri("http://example.com/cb")).toBe(false);
    expect(isValidRedirectUri("https://example.com/cb#fragment")).toBe(false);
    expect(isValidRedirectUri("https://user:pass@example.com/cb")).toBe(false);
    expect(isValidRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isValidRedirectUri("/relative/path")).toBe(false);
    expect(isValidRedirectUri("https://example.com/*")).toBe(false);
    expect(isValidRedirectUri("")).toBe(false);
  });
});

describe("scope parsing", () => {
  it("defaults to all MCP scopes when omitted", () => {
    expect(parseScopes(undefined)).toEqual([...MCP_SCOPES]);
    expect(parseScopes("")).toEqual([...MCP_SCOPES]);
  });

  it("parses known scopes and rejects unknown ones", () => {
    expect(parseScopes("read:issue write:issue")).toEqual(["read:issue", "write:issue"]);
    expect(() => parseScopes("read:issue admin:everything")).toThrow(OAuthError);
  });

  it("unions scope sets without duplicates", () => {
    expect(unionScopes(["read:issue"], ["read:issue", "write:issue"])).toEqual(["read:issue", "write:issue"]);
  });
});
