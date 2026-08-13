/**
 * OAuth 2.1 authorization-server integration tests: discovery metadata,
 * dynamic client registration, the consent flow, code/token exchange, PKCE,
 * refresh rotation, scope non-escalation, grant revocation, and OAuth-token
 * authentication at /mcp (including the discovery challenge header).
 */
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { api, mcpCall, mcpInitialize, post, testEnv } from "./helpers";
import { sha256Hex } from "../../src/server/auth/token-auth";
import { OAUTH_ACCESS_TOKEN_PREFIX, pkceChallenge } from "../../src/server/services/oauth-service";

const REDIRECT_URI = "https://chatgpt.example/oauth/callback";

interface RegisteredClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
}

async function registerClient(name = "ChatGPT"): Promise<RegisteredClient> {
  const res = await api("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT_URI] }),
  });
  expect(res.status).toBe(201);
  return res.body as RegisteredClient;
}

function authorizeUrl(client: RegisteredClient, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "read:issue read:search",
    ...extra,
  });
  return `https://nodebook.test/oauth/authorize?${params.toString()}`;
}

async function approve(client: RegisteredClient, verifier: string, extra: Record<string, string> = {}): Promise<URL> {
  const challenge = await pkceChallenge(verifier);
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "read:issue read:search",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz-state",
    decision: "approve",
    ...extra,
  });
  const res = await SELF.fetch("https://nodebook.test/oauth/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const location = res.headers.get("location");
  expect(location).toBeTruthy();
  return new URL(location!);
}

async function exchangeCode(
  client: RegisteredClient,
  code: string,
  verifier: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: client.client_id,
    code_verifier: verifier,
  });
  const res = await SELF.fetch("https://nodebook.test/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function refresh(
  client: RegisteredClient,
  refreshToken: string,
  extra: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client.client_id,
    ...extra,
  });
  const res = await SELF.fetch("https://nodebook.test/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Full happy path: register → consent → code → tokens. */
async function completeOauthFlow(): Promise<{
  client: RegisteredClient;
  accessToken: string;
  refreshToken: string;
  code: string;
  verifier: string;
}> {
  const client = await registerClient();
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const redirect = await approve(client, verifier);
  const code = redirect.searchParams.get("code")!;
  expect(redirect.searchParams.get("state")).toBe("xyz-state");
  const exchange = await exchangeCode(client, code, verifier);
  expect(exchange.status).toBe(200);
  return {
    client,
    accessToken: String(exchange.body.access_token),
    refreshToken: String(exchange.body.refresh_token),
    code,
    verifier,
  };
}

describe("OAuth discovery metadata", () => {
  it("serves authorization-server metadata anchored to the configured issuer", async () => {
    const res = await SELF.fetch("https://nodebook.test/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.issuer).toBe("https://nodebook.test");
    expect(meta.authorization_endpoint).toBe("https://nodebook.test/oauth/authorize");
    expect(meta.token_endpoint).toBe("https://nodebook.test/oauth/token");
    expect(meta.registration_endpoint).toBe("https://nodebook.test/oauth/register");
    expect(meta.response_types_supported).toEqual(["code"]);
    expect(meta.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(meta.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.scopes_supported).toContain("read:issue");
  });

  it("serves protected-resource metadata for /mcp", async () => {
    const res = await SELF.fetch("https://nodebook.test/.well-known/oauth-protected-resource/mcp");
    expect(res.status).toBe(200);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.resource).toBe("https://nodebook.test/mcp");
    expect(meta.authorization_servers).toEqual(["https://nodebook.test"]);
    expect(meta.scopes_supported).toContain("write:issue");
  });
});

describe("dynamic client registration", () => {
  it("registers a public client and echoes its metadata", async () => {
    const client = await registerClient("My client");
    expect(client.client_id).toMatch(/^nbkc_/);
    expect(client.token_endpoint_auth_method).toBe("none");
    expect(client.redirect_uris).toEqual([REDIRECT_URI]);
    expect(client.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(client.response_types).toEqual(["code"]);
  });

  it("rejects non-HTTPS redirect URIs", async () => {
    const res = await api("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "bad", redirect_uris: ["http://evil.example/cb"] }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid_redirect_uri");
  });

  it("rejects wildcard redirect URIs and missing metadata", async () => {
    const wildcard = await api("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "bad", redirect_uris: ["https://example.com/*"] }),
    });
    expect(wildcard.status).toBe(400);

    const noName = await api("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
    });
    expect(noName.status).toBe(400);
    expect((noName.body as { error: string }).error).toBe("invalid_client_metadata");
  });

  it("rejects confidential-client auth methods", async () => {
    const res = await api("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "secret-y",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "client_secret_basic",
      }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid_client_metadata");
  });
});

describe("authorization + consent", () => {
  it("renders a consent page listing the client and requested scopes", async () => {
    const client = await registerClient("Consent Tester");
    const challenge = await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    const res = await SELF.fetch(
      authorizeUrl(client, { code_challenge: challenge, code_challenge_method: "S256", state: "s1" }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Consent Tester");
    expect(text).toContain("read:issue");
    expect(text).toContain("read:search");
    expect(text).toContain("https://nodebook.test/mcp");
    expect(text).toContain("Approve");
  });

  it("redirects with access_denied when consent is denied", async () => {
    const client = await registerClient();
    const challenge = await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "read:issue",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "deny-state",
      decision: "deny",
    });
    const res = await SELF.fetch("https://nodebook.test/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("deny-state");
  });

  it("does not redirect when the client or redirect URI is unknown", async () => {
    const res = await SELF.fetch(
      authorizeUrl({ client_id: "nbkc_nope", client_name: "", redirect_uris: [], token_endpoint_auth_method: "none", grant_types: [], response_types: [] }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("rejects missing PKCE, non-S256 methods, unknown scopes, and bad resources with redirect errors", async () => {
    const client = await registerClient();

    // Missing code_challenge.
    let res = await SELF.fetch(authorizeUrl(client, { scope: "read:issue" }), { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");

    // Plain PKCE method is rejected.
    const challenge = await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    res = await SELF.fetch(authorizeUrl(client, { code_challenge: challenge, code_challenge_method: "plain" }), {
      redirect: "manual",
    });
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");

    // Unknown scope.
    res = await SELF.fetch(
      authorizeUrl(client, { code_challenge: challenge, code_challenge_method: "S256", scope: "read:issue admin" }),
      { redirect: "manual" },
    );
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_scope");

    // Wrong resource indicator.
    res = await SELF.fetch(
      authorizeUrl(client, { code_challenge: challenge, code_challenge_method: "S256", resource: "https://other.example/mcp" }),
      { redirect: "manual" },
    );
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");

    // Wrong response type.
    res = await SELF.fetch(
      authorizeUrl(client, { code_challenge: challenge, code_challenge_method: "S256", response_type: "token" }),
      { redirect: "manual" },
    );
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("unsupported_response_type");
  });
});

describe("token exchange", () => {
  it("exchanges a code for an access/refresh pair and calls /mcp", async () => {
    const { accessToken } = await completeOauthFlow();

    expect(accessToken.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)).toBe(true);
    const { sessionId } = await mcpInitialize(accessToken);
    expect(sessionId).toBeTruthy();

    const list = await mcpCall(accessToken, "tools/list", {}, sessionId);
    expect(list.status).toBe(200);
    const tools = (list.body.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toContain("get_issue");

    // Scopes from the consent are enforced per tool call.
    const denied = await mcpCall(
      accessToken,
      "tools/call",
      { name: "create_issue", arguments: { title: "nope" } },
      sessionId,
    );
    expect((denied.body.error as { code: number }).code).toBe(-32003);

    // Unknown tokens get the discovery challenge header.
    const unauth = await SELF.fetch("https://nodebook.test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("www-authenticate")).toContain("resource_metadata=");
    expect(unauth.headers.get("www-authenticate")).toContain(
      "https://nodebook.test/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("rejects code reuse and PKCE mismatches", async () => {
    const client = await registerClient();
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const redirect = await approve(client, verifier);
    const code = redirect.searchParams.get("code")!;

    const first = await exchangeCode(client, code, verifier);
    expect(first.status).toBe(200);

    // Same code again → invalid_grant (single-use).
    const second = await exchangeCode(client, code, verifier);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("invalid_grant");

    // Wrong verifier → invalid_grant.
    const redirect2 = await approve(client, verifier);
    const code2 = redirect2.searchParams.get("code")!;
    const wrongPkce = await exchangeCode(client, code2, `${verifier}x`);
    expect(wrongPkce.status).toBe(400);
    expect(wrongPkce.body.error).toBe("invalid_grant");
  });

  it("rejects unknown and expired authorization codes", async () => {
    const res = await exchangeCode(
      { client_id: "nbkc_unknown", client_name: "", redirect_uris: [], token_endpoint_auth_method: "none", grant_types: [], response_types: [] },
      "nbc_definitely-not-real",
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");

    // Insert a code with a past expiry directly, then try to exchange it.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const client = await registerClient();
    const redirect = await approve(client, verifier);
    const db = testEnv().DB;
    await db
      .prepare(
        `UPDATE oauth_codes SET expires_at = ? WHERE code_hash = ?`,
      )
      .bind(new Date(Date.now() - 60_000).toISOString(), await sha256Hex(redirect.searchParams.get("code")!))
      .run();
    const expired = await exchangeCode(client, redirect.searchParams.get("code")!, verifier);
    expect(expired.status).toBe(400);
    expect(expired.body.error).toBe("invalid_grant");
  });

  it("rejects unsupported grant types", async () => {
    const body = new URLSearchParams({ grant_type: "password", username: "x", password: "y" });
    const res = await SELF.fetch("https://nodebook.test/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("unsupported_grant_type");
  });
});

describe("refresh token rotation", () => {
  it("rotates refresh tokens and rejects reuse of the old one", async () => {
    const { client, refreshToken } = await completeOauthFlow();

    const rotated = await refresh(client, refreshToken);
    expect(rotated.status).toBe(200);
    const newRefresh = String(rotated.body.refresh_token);
    expect(newRefresh).not.toBe(refreshToken);
    const newAccess = String(rotated.body.access_token);
    expect(newAccess.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(rotated.body.scope).toBe("read:issue read:search");

    // The new access token works at /mcp.
    const { sessionId } = await mcpInitialize(newAccess);
    expect(sessionId).toBeTruthy();

    // Reuse of the rotated-away refresh token fails.
    const replay = await refresh(client, refreshToken);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");

    // The new refresh token still works.
    const again = await refresh(client, newRefresh);
    expect(again.status).toBe(200);
  });

  it("never lets a refresh expand the approved scopes", async () => {
    const { client, refreshToken } = await completeOauthFlow();

    const expanded = await refresh(client, refreshToken, { scope: "read:issue read:search write:issue" });
    expect(expanded.status).toBe(400);
    expect(expanded.body.error).toBe("invalid_scope");

    // Subset requests are fine and narrow the resulting access token.
    const narrowed = await refresh(client, refreshToken, { scope: "read:issue" });
    expect(narrowed.status).toBe(200);
    expect(narrowed.body.scope).toBe("read:issue");
  });
});

describe("grant revocation", () => {
  it("revokes the connection via the owner API and kills access + refresh tokens", async () => {
    const { client, accessToken, refreshToken } = await completeOauthFlow();
    const { sessionId } = await mcpInitialize(accessToken);
    expect(sessionId).toBeTruthy();

    // The connection is visible in the owner settings API.
    const grants = (await api("/api/tokens/oauth-grants")).body as {
      id: string;
      client_name: string;
      scopes: string[];
      revoked_at: string | null;
    }[];
    expect(grants.some((g) => g.client_name === "ChatGPT" && g.scopes.includes("read:issue") && !g.revoked_at)).toBe(true);
    const grant = grants.find((g) => g.client_name === "ChatGPT")!;

    const revoked = await post(`/api/tokens/oauth-grants/${grant.id}/revoke`, {});
    expect(revoked.status).toBe(200);
    expect((revoked.body as { revoked_at: string | null }).revoked_at).toBeTruthy();

    // Access token dies on the next request.
    const after = await mcpCall(accessToken, "ping", {}, sessionId);
    expect(after.status).toBe(401);
    expect(after.body.error).toBeDefined();

    // Refresh token dies too.
    const refreshRes = await refresh(client, refreshToken);
    expect(refreshRes.status).toBe(400);
    expect(refreshRes.body.error).toBe("invalid_grant");

    // Audit trail records the approval and the revocation.
    const audit = await testEnv().DB.prepare(
      "SELECT action, actor_type, actor_id FROM audit_events WHERE entity_type = 'oauth_grant' AND entity_id = ? ORDER BY created_at",
    )
      .bind(grant.id)
      .all<{ action: string; actor_type: string; actor_id: string }>();
    expect(audit.results.map((r) => r.action)).toEqual(["oauth_grant.approve", "oauth_grant.revoke"]);
    expect(audit.results[0]!.actor_type).toBe("human");
    expect(audit.results[0]!.actor_id).toBe("owner@test.dev");

    // The connection now shows as revoked in the owner settings API.
    const list = (await api("/api/tokens/oauth-grants")).body as { id: string; revoked_at: string | null }[];
    expect(list.find((g) => g.id === grant.id)!.revoked_at).toBeTruthy();
  });

  it("rejects expired access tokens", async () => {
    const { accessToken } = await completeOauthFlow();
    const db = testEnv().DB;
    await db
      .prepare("UPDATE oauth_tokens SET expires_at = ? WHERE kind = 'access' AND token_hash = ?")
      .bind(new Date(Date.now() - 60_000).toISOString(), await sha256Hex(accessToken))
      .run();
    const res = await mcpCall(accessToken, "ping");
    expect(res.status).toBe(401);
  });

  it("attributes MCP mutations to the stable OAuth grant id", async () => {
    // Grant write scope by approving again (merges scopes into the grant).
    const client = await registerClient("ChatGPT");
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const redirect = await approve(client, verifier, { scope: "read:issue read:search write:issue" });
    const exchange = await exchangeCode(client, redirect.searchParams.get("code")!, verifier);
    const writeAccess = String(exchange.body.access_token);

    const { sessionId } = await mcpInitialize(writeAccess);
    const res = await mcpCall(
      writeAccess,
      "tools/call",
      { name: "create_issue", arguments: { title: "oauth attribution", type: "finding" } },
      sessionId,
    );
    expect(res.body.error).toBeUndefined();
    const dto = JSON.parse((res.body.result as { content: { text: string }[] }).content[0]!.text) as { number: number };

    const history = (await api(`/api/issues/${dto.number}/history`)).body as {
      actor_type: string;
      actor_id: string;
      action: string;
    }[];
    const create = history.find((e) => e.action === "issue.create")!;
    expect(create.actor_type).toBe("mcp");
    expect(create.actor_id).toMatch(/^[0-9a-f-]{36}$/);

    // The same grant id appears in the owner settings list.
    const grants = (await api("/api/tokens/oauth-grants")).body as { id: string }[];
    expect(grants.map((g) => g.id)).toContain(create.actor_id);
  });
});
