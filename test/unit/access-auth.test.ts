import { describe, expect, it } from "vitest";
import { verifyAccessJwt, base64urlToString, authenticateAccess } from "../../src/server/auth/access-auth";
import { AuthError } from "../../src/domain/errors";

/**
 * Generate an RSA key pair and sign a Cloudflare-Access-style JWT so the
 * verifier can be tested against a local JWKS.
 */
async function makeJwks() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const kid = "test-key-1";
  const jwks = { keys: [{ kid, kty: "RSA", n: jwk.n!, e: jwk.e! }] };
  const fetchImpl = async (): Promise<Response> =>
    new Response(JSON.stringify(jwks), { status: 200, headers: { "Content-Type": "application/json" } });
  return { pair, kid, fetchImpl };
}

function b64url(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function signJwt(pair: CryptoKeyPair, header: Record<string, unknown>, payload: Record<string, unknown>): Promise<string> {
  const h = b64urlJson(header);
  const p = b64urlJson(payload);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${h}.${p}`),
  );
  return `${h}.${p}.${b64url(signature)}`;
}

const TEAM = "example.cloudflareaccess.com";
const AUD = "aud-tag-123";

let teamCounter = 0;
function uniqueTeam(): string {
  teamCounter += 1;
  return `team-${teamCounter}.cloudflareaccess.com`;
}

describe("verifyAccessJwt", () => {
  it("accepts a valid token for the configured audience and team", async () => {
    const { pair, kid, fetchImpl } = await makeJwks();
    const team = uniqueTeam();
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(pair, { kid, alg: "RS256" }, {
      aud: AUD,
      exp: now + 3600,
      iat: now,
      iss: `https://${team}`,
      email: "owner@example.com",
      common_name: "owner@example.com",
    });
    const payload = await verifyAccessJwt(token, { team, aud: AUD, fetchImpl, now: now * 1000 });
    expect(payload.email).toBe("owner@example.com");
  });

  it("accepts array audiences containing the configured one", async () => {
    const { pair, kid, fetchImpl } = await makeJwks();
    const team = uniqueTeam();
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(pair, { kid, alg: "RS256" }, {
      aud: [AUD, "other-app"],
      exp: now + 3600,
      iss: `https://${team}`,
      email: "owner@example.com",
    });
    await expect(verifyAccessJwt(token, { team, aud: AUD, fetchImpl, now: now * 1000 })).resolves.toBeTruthy();
  });

  it("rejects a malformed token", async () => {
    await expect(verifyAccessJwt("not.a.jwt", { team: TEAM, aud: AUD })).rejects.toThrow(AuthError);
    await expect(verifyAccessJwt("a.b", { team: TEAM, aud: AUD })).rejects.toThrow(AuthError);
  });

  it("rejects an unknown kid", async () => {
    const { pair, fetchImpl } = await makeJwks();
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(pair, { kid: "unknown", alg: "RS256" }, {
      aud: AUD,
      exp: now + 3600,
      iss: `https://${TEAM}`,
      email: "owner@example.com",
    });
    await expect(verifyAccessJwt(token, { team: uniqueTeam(), aud: AUD, fetchImpl, now: now * 1000 })).rejects.toThrow(
      "Unknown JWT signing key",
    );
  });

  it("rejects a tampered signature", async () => {
    const { pair, kid, fetchImpl } = await makeJwks();
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(pair, { kid, alg: "RS256" }, {
      aud: AUD,
      exp: now + 3600,
      iss: `https://${TEAM}`,
      email: "owner@example.com",
    });
    const tampered = `${token.slice(0, -2)}aa`;
    await expect(verifyAccessJwt(tampered, { team: uniqueTeam(), aud: AUD, fetchImpl, now: now * 1000 })).rejects.toThrow(
      "Invalid JWT signature",
    );
  });

  it("rejects an expired token", async () => {
    const { pair, kid, fetchImpl } = await makeJwks();
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(pair, { kid, alg: "RS256" }, {
      aud: AUD,
      exp: now - 10,
      iss: `https://${TEAM}`,
      email: "owner@example.com",
    });
    await expect(verifyAccessJwt(token, { team: uniqueTeam(), aud: AUD, fetchImpl, now: now * 1000 })).rejects.toThrow("expired");
  });

  it("rejects a wrong audience", async () => {
    const { pair, kid, fetchImpl } = await makeJwks();
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(pair, { kid, alg: "RS256" }, {
      aud: "other-aud",
      exp: now + 3600,
      iss: `https://${TEAM}`,
      email: "owner@example.com",
    });
    await expect(verifyAccessJwt(token, { team: uniqueTeam(), aud: AUD, fetchImpl, now: now * 1000 })).rejects.toThrow(
      "audience mismatch",
    );
  });

  it("rejects a wrong issuer", async () => {
    const { pair, kid, fetchImpl } = await makeJwks();
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(pair, { kid, alg: "RS256" }, {
      aud: AUD,
      exp: now + 3600,
      iss: "https://evil.example.com",
      email: "owner@example.com",
    });
    await expect(verifyAccessJwt(token, { team: uniqueTeam(), aud: AUD, fetchImpl, now: now * 1000 })).rejects.toThrow(
      "issuer mismatch",
    );
  });

  it("rejects non-RS256 algorithms", async () => {
    const { pair, kid, fetchImpl } = await makeJwks();
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(pair, { kid, alg: "HS256" }, {
      aud: AUD,
      exp: now + 3600,
      iss: `https://${TEAM}`,
      email: "owner@example.com",
    });
    await expect(verifyAccessJwt(token, { team: uniqueTeam(), aud: AUD, fetchImpl, now: now * 1000 })).rejects.toThrow(
      "Unsupported JWT algorithm",
    );
  });

  it("fails closed when the JWKS endpoint fails", async () => {
    const fetchImpl = async (): Promise<Response> => new Response("boom", { status: 500 });
    await expect(verifyAccessJwt("a.b.c", { team: uniqueTeam(), aud: AUD, fetchImpl })).rejects.toThrow(AuthError);
  });
});

describe("base64urlToString", () => {
  it("decodes base64url", () => {
    expect(base64urlToString("aGVsbG8")).toBe("hello");
    expect(base64urlToString("aGVsbG8td29ybGQ")).toBe("hello-world");
  });
});

describe("authenticateAccess fail-closed behavior", () => {
  it("rejects requests when only one Access variable is configured", async () => {
    const env = {
      ACCESS_TEAM: TEAM,
      ACCESS_AUD: "",
      OWNER_EMAIL: "owner@example.com",
      AUTH_DEV_EMAIL: "owner@example.com",
    } as unknown as Parameters<typeof authenticateAccess>[0];
    const request = new Request("https://nodebook.test/api/me");
    // Partial Access config must not degrade into the dev identity.
    await expect(authenticateAccess(env, request)).rejects.toThrow("Incomplete Cloudflare Access configuration");
  });

  it("rejects every identity when Access is configured but OWNER_EMAIL is unset", async () => {
    const { pair, kid, fetchImpl } = await makeJwks();
    const team = uniqueTeam();
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(pair, { kid, alg: "RS256" }, {
      aud: AUD,
      exp: now + 3600,
      iss: `https://${team}`,
      email: "anyone@example.com",
    });
    const env = {
      ACCESS_TEAM: team,
      ACCESS_AUD: AUD,
      OWNER_EMAIL: "",
      AUTH_DEV_EMAIL: "",
    } as unknown as Parameters<typeof authenticateAccess>[0];
    const request = new Request("https://nodebook.test/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    // Fail closed even though the JWT itself is valid and would pass the
    // Access application check.
    await expect(authenticateAccess(env, request, fetchImpl)).rejects.toThrow("OWNER_EMAIL is not configured");
  });
});
