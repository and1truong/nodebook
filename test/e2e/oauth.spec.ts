/**
 * OAuth connector acceptance flow (browser): dynamic client registration,
 * the owner consent page, code exchange, an OAuth-authenticated /mcp call,
 * and OAuth connection management (listing + revocation) in Settings.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = "http://localhost:8787";
const REDIRECT_URI = "http://localhost:8787/oauth/callback";

async function apiJson(request: APIRequestContext, method: string, path: string, body?: unknown, form?: boolean) {
  const res = await request.fetch(`${BASE}${path}`, {
    method,
    headers: form ? { "Content-Type": "application/x-www-form-urlencoded" } : { "Content-Type": "application/json" },
    data: form ? body : body ? JSON.stringify(body) : undefined,
    maxRedirects: 0,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status(), json, headers: res.headers() };
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

test.describe.serial("OAuth connector", () => {
  let clientId: string;
  let accessToken: string;

  test("register a public client and approve the consent page", async ({ page, request }) => {
    const registered = await apiJson(request, "POST", "/oauth/register", {
      client_name: "ChatGPT e2e",
      redirect_uris: [REDIRECT_URI],
    });
    expect(registered.status).toBe(201);
    clientId = (registered.json as { client_id: string }).client_id;

    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await pkceChallenge(verifier);
    const authorize = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "read:issue read:search",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "e2e-state",
    });

    await page.goto(`/oauth/authorize?${authorize.toString()}`);
    await expect(page.getByRole("heading", { name: "Authorize MCP connection" })).toBeVisible();
    await expect(page.getByText("ChatGPT e2e", { exact: true })).toBeVisible();
    await expect(page.locator(".scopes", { hasText: "read:issue" })).toBeVisible();

    await page.getByRole("button", { name: "Approve" }).click();

    // Redirected back with the one-time code and the passthrough state.
    await page.waitForURL(/\/oauth\/callback\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("state")).toBe("e2e-state");
    const code = url.searchParams.get("code")!;
    expect(code.startsWith("nbc_")).toBe(true);

    // Exchange the code (PKCE verified server-side).
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    });
    const exchanged = await apiJson(request, "POST", "/oauth/token", tokenBody.toString(), true);
    expect(exchanged.status).toBe(200);
    accessToken = (exchanged.json as { access_token: string }).access_token;
    expect(accessToken.startsWith("nbo_")).toBe(true);
    expect((exchanged.json as { scope: string }).scope).toBe("read:issue read:search");
  });

  test("OAuth access token authenticates /mcp", async ({ request }) => {
    const init = await request.fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      data: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(init.status()).toBe(200);
    const sessionId = init.headers()["mcp-session-id"]!;

    const tools = await request.fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Mcp-Session-Id": sessionId,
      },
      data: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    expect(tools.status()).toBe(200);
    const body = (await tools.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name)).toContain("get_issue");
  });

  test("settings lists the OAuth connection and revoking it breaks tool calls", async ({ page, request }) => {
    await page.goto("/settings/tokens");
    const section = page.locator(".oauth-grants-table");
    await expect(section).toBeVisible();
    const row = section.locator("tr", { hasText: "ChatGPT e2e" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("read:issue");
    await expect(row).toContainText("active");

    await row.getByRole("button", { name: "revoke" }).click();
    await expect(row).toContainText("revoked");

    // The connector dies immediately.
    const after = await request.fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      data: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }),
    });
    expect(after.status()).toBe(401);
    expect(after.headers()["www-authenticate"]).toContain("resource_metadata=");
  });
});
