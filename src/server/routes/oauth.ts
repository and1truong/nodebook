/**
 * OAuth 2.1 endpoints:
 *  - discovery: /.well-known/oauth-authorization-server (RFC 8414),
 *    /.well-known/oauth-protected-resource/mcp (RFC 9728)
 *  - /oauth/register  — dynamic client registration (RFC 7591)
 *  - /oauth/authorize — owner authorization + consent (GET renders the
 *    consent page after the Cloudflare Access owner check; POST records the
 *    decision and redirects with the one-time code)
 *  - /oauth/token     — authorization-code and refresh-token exchanges
 *
 * These endpoints (except the owner-facing authorize flow) are reachable by
 * OAuth clients without a Cloudflare Access header.
 */
import { Hono, type Context } from "hono";
import type { AppEnv } from "./helpers";
import { oauthIssuer } from "../../env";
import { MCP_SCOPES } from "../../shared/limits";
import { authenticateAccess } from "../auth/access-auth";
import type { Ctx } from "../ctx";
import {
  approveAuthorization,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  loadAuthorizeClient,
  OAuthError,
  parseAuthorizeForm,
  parseAuthorizeQuery,
  registerClient,
  validateAuthorizeRequest,
  validateRegistrationInput,
} from "../services/oauth-service";

export const oauthRoutes = new Hono<AppEnv>();

// Protocol errors must surface as RFC-style JSON, not generic 500s.
oauthRoutes.onError((err, c) => {
  if (err instanceof OAuthError) {
    return c.json(
      { error: err.code, ...(err.description ? { error_description: err.description } : {}) },
      err.status as 400,
      { "Cache-Control": "no-store", Pragma: "no-cache" },
    );
  }
  console.error("OAuth route error", err);
  return c.json({ error: "server_error" }, 500);
});

function html(body: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NodeBook — OAuth</title><style>
:root { color-scheme: light dark; }
body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #f5f0e8; color: #3a2e1f; display: grid; place-items: center; min-height: 100vh; }
@media (prefers-color-scheme: dark) { body { background: #1a1200; color: #f0e6d0; } }
.card { background: #fffcf6; border: 1px solid #e5dcc8; border-radius: 12px; padding: 28px 32px; max-width: 520px; width: calc(100% - 48px); box-shadow: 0 8px 24px rgba(0,0,0,.08); }
@media (prefers-color-scheme: dark) { .card { background: #251a00; border-color: #4a3a14; } }
h1 { font-size: 1.25rem; margin: 0 0 4px; }
p.lead { margin: 8px 0 16px; opacity: .85; }
dl { margin: 0 0 20px; font-size: .9rem; }
dt { font-weight: 600; margin-top: 10px; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
dd { margin: 2px 0 0; word-break: break-all; }
ul.scopes { margin: 4px 0 0; padding-left: 18px; }
.actions { display: flex; gap: 10px; margin-top: 20px; }
button { flex: 1; padding: 10px 16px; border-radius: 8px; font-size: .95rem; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
.approve { background: #7a5c00; color: #fff; }
.approve:hover { background: #6a4f00; }
.deny { background: transparent; border-color: #c8bda4; color: inherit; }
.muted { opacity: .7; font-size: .8rem; }
.error { color: #b91c1c; }
</style></head><body><main class="card">${body}</main></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ownerCtx(email: string, env: AppEnv["Bindings"]): Ctx {
  return { env, actor: { type: "human", id: email }, requestId: crypto.randomUUID() };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

oauthRoutes.get("/.well-known/oauth-authorization-server", (c) => {
  const issuer = oauthIssuer(c.env, c.req.raw);
  return c.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...MCP_SCOPES],
  });
});

oauthRoutes.get("/.well-known/oauth-protected-resource/mcp", (c) => {
  const issuer = oauthIssuer(c.env, c.req.raw);
  return c.json({
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
  });
});

// ---------------------------------------------------------------------------
// Dynamic client registration
// ---------------------------------------------------------------------------

oauthRoutes.post("/oauth/register", async (c) => {
  const raw = await c.req.json().catch(() => {
    throw new OAuthError("invalid_client_metadata", 400, "Body must be a JSON object");
  });
  const client = await registerClient(c.env, validateRegistrationInput(raw));
  return c.json(client, 201);
});

// ---------------------------------------------------------------------------
// Authorization + consent
// ---------------------------------------------------------------------------

async function authorizeHandler(
  c: Context<AppEnv>,
  params: ReturnType<typeof parseAuthorizeQuery>,
): Promise<Response> {
  const found = await loadAuthorizeClient(c.env, params);
  if (!found) {
    return html('<h1>Invalid authorization request</h1><p class="lead error">Unknown client or redirect URI. The request was not redirected anywhere.</p>', 400);
  }
  let validated: ReturnType<typeof validateAuthorizeRequest>;
  try {
    validated = validateAuthorizeRequest(c.env, params, c.req.raw);
  } catch (e) {
    if (e instanceof OAuthError) {
      return redirectWithError(found.redirectUri, e.code, params.state);
    }
    throw e;
  }

  try {
    await authenticateAccess(c.env, c.req.raw);
  } catch {
    return html(
      '<h1>Sign in required</h1><p class="lead">This NodeBook workspace is private. Sign in with the workspace owner account to authorize this connection.</p>',
      401,
    );
  }

  return html(consentPage(found.client.client_name, found.redirectUri, validated.scopes, validated.resource, params));
}

function consentPage(
  clientName: string,
  redirectUri: string,
  scopes: string[],
  resource: string,
  params: ReturnType<typeof parseAuthorizeQuery>,
): string {
  const scopeList = scopes
    .map((s) => `<li><code>${escapeHtml(s)}</code></li>`)
    .join("");
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
  return `
<h1>Authorize MCP connection</h1>
<p class="lead"><strong>${escapeHtml(clientName)}</strong> is requesting access to your NodeBook workspace.</p>
<dl>
  <dt>Requested scopes</dt>
  <dd><ul class="scopes">${scopeList}</ul></dd>
  <dt>Resource</dt>
  <dd>${escapeHtml(resource)}</dd>
  <dt>Redirect URI</dt>
  <dd>${escapeHtml(redirectUri)}</dd>
</dl>
<form method="post" action="/oauth/authorize">
  ${hidden("client_id", params.clientId)}
  ${hidden("redirect_uri", params.redirectUri)}
  ${hidden("response_type", params.responseType)}
  ${hidden("code_challenge", params.codeChallenge)}
  ${hidden("code_challenge_method", params.codeChallengeMethod)}
  ${hidden("scope", params.scope ?? "")}
  ${hidden("resource", params.resource ?? "")}
  ${params.state ? hidden("state", params.state) : ""}
  <div class="actions">
    <button type="submit" name="decision" value="approve" class="approve">Approve</button>
    <button type="submit" name="decision" value="deny" class="deny">Deny</button>
  </div>
</form>
<p class="muted">Approving lets this client call MCP tools on your behalf with the scopes above. You can revoke this connection anytime in Settings → MCP tokens.</p>`;
}

function redirectWithError(redirectUri: string, error: string, state: string | null): Response {
  const params = new URLSearchParams();
  params.set("error", error);
  if (state) params.set("state", state);
  return Response.redirect(`${redirectUri}${redirectUri.includes("?") ? "&" : "?"}${params.toString()}`, 302);
}

function queryToSearchParams(query: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, value);
  return params;
}

oauthRoutes.get("/oauth/authorize", async (c) => {
  return authorizeHandler(c, parseAuthorizeQuery(queryToSearchParams(c.req.query())));
});

oauthRoutes.post("/oauth/authorize", async (c) => {
  const form = await c.req.parseBody();
  const params = parseAuthorizeForm(form);
  const decision = typeof form.decision === "string" ? form.decision : "";

  const found = await loadAuthorizeClient(c.env, params);
  if (!found) {
    return html('<h1>Invalid authorization request</h1><p class="lead error">Unknown client or redirect URI.</p>', 400);
  }
  let validated: ReturnType<typeof validateAuthorizeRequest>;
  try {
    validated = validateAuthorizeRequest(c.env, params, c.req.raw);
  } catch (e) {
    if (e instanceof OAuthError) return redirectWithError(found.redirectUri, e.code, params.state);
    throw e;
  }

  let identity: { email: string };
  try {
    identity = await authenticateAccess(c.env, c.req.raw);
  } catch {
    return html('<h1>Sign in required</h1><p class="lead">Re-authenticate and try again.</p>', 401);
  }

  if (decision === "deny") {
    return redirectWithError(found.redirectUri, "access_denied", params.state);
  }
  if (decision !== "approve") {
    return html(
      consentPage(found.client.client_name, found.redirectUri, validated.scopes, validated.resource, params) +
        '<p class="error">Choose Approve or Deny.</p>',
      400,
    );
  }

  const ctx = ownerCtx(identity.email, c.env);
  const result = await approveAuthorization(
    c.env,
    ctx,
    found.client,
    found.redirectUri,
    validated.state,
    validated.codeChallenge,
    validated.scopes,
    validated.resource,
  );
  const paramsOut = new URLSearchParams();
  paramsOut.set("code", result.code);
  if (result.state) paramsOut.set("state", result.state);
  return Response.redirect(`${result.redirectUri}${result.redirectUri.includes("?") ? "&" : "?"}${paramsOut.toString()}`, 302);
});

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

oauthRoutes.post("/oauth/token", async (c) => {
  const body = await c.req.parseBody();
  const grantType = typeof body.grant_type === "string" ? body.grant_type : "";
  try {
    if (grantType === "authorization_code") {
      const result = await exchangeAuthorizationCode(c.env, {
        code: typeof body.code === "string" ? body.code : undefined,
        redirect_uri: typeof body.redirect_uri === "string" ? body.redirect_uri : undefined,
        client_id: typeof body.client_id === "string" ? body.client_id : undefined,
        code_verifier: typeof body.code_verifier === "string" ? body.code_verifier : undefined,
      });
      return tokenJson(c, result);
    }
    if (grantType === "refresh_token") {
      const result = await exchangeRefreshToken(c.env, {
        refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
        client_id: typeof body.client_id === "string" ? body.client_id : undefined,
        scope: typeof body.scope === "string" ? body.scope : undefined,
      });
      return tokenJson(c, result);
    }
    throw new OAuthError("unsupported_grant_type", 400, "Only authorization_code and refresh_token grants are supported");
  } catch (e) {
    if (e instanceof OAuthError) {
      return c.json(
        { error: e.code, ...(e.description ? { error_description: e.description } : {}) },
        e.status as 400,
        { "Cache-Control": "no-store", Pragma: "no-cache" },
      );
    }
    throw e;
  }
});

function tokenJson(c: Context<AppEnv>, result: unknown): Response {
  return c.json(result, 200, { "Cache-Control": "no-store", Pragma: "no-cache" });
}
