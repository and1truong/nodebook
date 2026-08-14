/**
 * OAuth 2.1 authorization server core (RFC 6749 + 7636 PKCE + 7591 dynamic
 * client registration + 8707 resource indicators + 9728 resource metadata).
 *
 * The server is single-owner: Cloudflare Access authenticates the owner at
 * the consent endpoint, and every client is a public client using S256 PKCE.
 * No implicit, password, or client-credentials grants are supported.
 */
import type { Env } from "../../env";
import { oauthIssuer } from "../../env";
import type { Ctx } from "../ctx";
import { ValidationError } from "../../domain/errors";
import type { OauthClientRecord, OauthGrantRecord } from "../../domain/models";
import { MCP_SCOPES, type McpScope } from "../../shared/limits";
import { sha256Hex } from "../auth/token-auth";
import { recordAudit } from "./audit-service";
import { attributionFromCtx } from "../ctx";
import * as oauthRepo from "../repositories/oauth";

/** Authorization codes expire after 10 minutes and are single-use. */
export const OAUTH_AUTH_CODE_TTL_MS = 10 * 60 * 1000;
/** Access tokens are opaque and short-lived. */
export const OAUTH_ACCESS_TOKEN_TTL_MS = 10 * 60 * 1000;
/** Refresh tokens have a bounded lifetime; each use rotates them. */
export const OAUTH_REFRESH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export const OAUTH_ACCESS_TOKEN_PREFIX = "nbo_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "nbr_";
export const OAUTH_AUTH_CODE_PREFIX = "nbc_";
export const OAUTH_CLIENT_ID_PREFIX = "nbkc_";

/** Protocol-level error carrying an RFC 6749 §5.2 error code. */
export class OAuthError extends Error {
  readonly code: string;
  readonly status: number;
  readonly description?: string;

  constructor(code: string, status = 400, description?: string) {
    super(code);
    this.name = "OAuthError";
    this.code = code;
    this.status = status;
    this.description = description;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Redirect URIs must be exact matches against the registered allowlist. HTTPS
 * is required except for loopback hosts (localhost/127.0.0.1/::1), which is
 * the standard exception for local development clients.
 */
export function isValidRedirectUri(uri: string): boolean {
  if (!uri || /[*{}]/.test(uri)) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")) {
    return true;
  }
  return false;
}

export function parseScopes(scopeParam: string | undefined): McpScope[] {
  if (scopeParam === undefined || scopeParam === null) return [...MCP_SCOPES];
  const parts = scopeParam.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [...MCP_SCOPES];
  const scopes: McpScope[] = [];
  for (const part of parts) {
    if (!MCP_SCOPES.includes(part as McpScope)) {
      throw new OAuthError("invalid_scope", 400, `Unknown scope: ${part}`);
    }
    scopes.push(part as McpScope);
  }
  return scopes;
}

export function unionScopes(existing: McpScope[], added: McpScope[]): McpScope[] {
  return [...new Set([...existing, ...added])];
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Opaque high-entropy credential (32 random bytes, base64url). */
export function randomToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${prefix}${base64urlEncode(bytes)}`;
}

/** RFC 7636 S256 code challenge. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64urlEncode(new Uint8Array(digest));
}

export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  if (!verifier || !challenge) return false;
  if (verifier.length < 43 || verifier.length > 128) return false;
  try {
    return (await pkceChallenge(verifier)) === challenge;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Dynamic client registration (RFC 7591)
// ---------------------------------------------------------------------------

export interface RegisteredClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  grant_types: string[];
  response_types: string[];
  client_id_issued_at: number;
}

export async function registerClient(
  env: Env,
  input: {
    redirect_uris: unknown;
    client_name: unknown;
    grant_types?: unknown;
    response_types?: unknown;
    token_endpoint_auth_method?: unknown;
  },
): Promise<RegisteredClient> {
  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0) {
    throw new OAuthError("invalid_redirect_uri", 400, "redirect_uris must be a non-empty array");
  }
  const redirectUris = [...new Set(input.redirect_uris.map((u) => String(u).trim()).filter(Boolean))];
  if (redirectUris.length === 0 || redirectUris.some((u) => !isValidRedirectUri(u))) {
    throw new OAuthError("invalid_redirect_uri", 400, "Every redirect_uri must be an absolute HTTPS URL (loopback http allowed) without a fragment");
  }

  const clientName = typeof input.client_name === "string" ? input.client_name.trim() : "";
  if (!clientName || clientName.length > 128) {
    throw new OAuthError("invalid_client_metadata", 400, "client_name must be a non-empty string of at most 128 characters");
  }

  const authMethod = input.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== null && authMethod !== "none") {
    throw new OAuthError("invalid_client_metadata", 400, "Only public clients (token_endpoint_auth_method=none) are supported");
  }

  const grantTypes =
    input.grant_types === undefined
      ? ["authorization_code", "refresh_token"]
      : Array.isArray(input.grant_types)
        ? input.grant_types.map((g) => String(g))
        : [];
  const allowedGrants = new Set(["authorization_code", "refresh_token"]);
  if (grantTypes.length === 0 || grantTypes.some((g) => !allowedGrants.has(g))) {
    throw new OAuthError("invalid_client_metadata", 400, "grant_types must be a subset of [authorization_code, refresh_token]");
  }

  const responseTypes = input.response_types === undefined ? ["code"] : Array.isArray(input.response_types) ? input.response_types.map((r) => String(r)) : [];
  if (responseTypes.length !== 1 || responseTypes[0] !== "code") {
    throw new OAuthError("invalid_client_metadata", 400, "response_types must be [code]");
  }

  const clientId = randomToken(OAUTH_CLIENT_ID_PREFIX);
  await oauthRepo.insertClient(env.DB, {
    id: crypto.randomUUID(),
    clientId,
    clientName,
    redirectUrisJson: JSON.stringify(redirectUris),
    now: new Date().toISOString(),
  });

  return {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: grantTypes,
    response_types: responseTypes,
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
}

// ---------------------------------------------------------------------------
// Authorization endpoint
// ---------------------------------------------------------------------------

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  responseType: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string | undefined;
  resource: string | undefined;
}

export interface ValidatedAuthorizeRequest {
  client: OauthClientRecord;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scopes: McpScope[];
  resource: string;
}

/**
 * Load the client and verify the redirect URI. Returns null when the client
 * is unknown or the redirect URI is missing/not registered — in that case the
 * request must NOT be redirected anywhere (RFC 6749 §4.1.2.1).
 */
export async function loadAuthorizeClient(env: Env, params: AuthorizeParams): Promise<{ client: OauthClientRecord; redirectUri: string } | null> {
  if (!params.clientId) return null;
  const client = await oauthRepo.getClientByClientId(env.DB, params.clientId);
  if (!client) return null;
  let redirectUris: string[] = [];
  try {
    const parsed = JSON.parse(client.redirect_uris_json) as unknown;
    if (Array.isArray(parsed)) redirectUris = parsed.map((u) => String(u));
  } catch {
    redirectUris = [];
  }
  if (!params.redirectUri || !redirectUris.includes(params.redirectUri)) return null;
  return { client, redirectUri: params.redirectUri };
}

/**
 * Validate the remaining authorization parameters. Throws OAuthError for
 * errors that are safe to redirect back with (the caller has already verified
 * the redirect URI is registered).
 */
export function validateAuthorizeRequest(
  env: Env,
  params: AuthorizeParams,
  request?: Request,
): Omit<ValidatedAuthorizeRequest, "client"> {
  if (params.responseType !== "code") {
    throw new OAuthError("unsupported_response_type", 400, "Only response_type=code is supported");
  }
  if (!params.codeChallenge) {
    throw new OAuthError("invalid_request", 400, "code_challenge is required (PKCE)");
  }
  if (params.codeChallengeMethod !== "S256") {
    throw new OAuthError("invalid_request", 400, "Only S256 PKCE is supported");
  }
  const scopes = parseScopes(params.scope);
  const resource = params.resource ?? `${oauthIssuer(env, request)}/mcp`;
  if (resource !== `${oauthIssuer(env, request)}/mcp`) {
    throw new OAuthError("invalid_target", 400, "resource must be the NodeBook MCP endpoint");
  }
  return {
    redirectUri: params.redirectUri,
    state: params.state,
    codeChallenge: params.codeChallenge,
    scopes,
    resource,
  };
}

/**
 * Record owner approval: reuse the stable grant for this client (merging the
 * newly approved scopes) and issue a single-use authorization code.
 */
export async function approveAuthorization(
  env: Env,
  ctx: Ctx,
  client: OauthClientRecord,
  redirectUri: string,
  state: string | null,
  codeChallenge: string,
  scopes: McpScope[],
  resource: string,
): Promise<{ code: string; redirectUri: string; state: string | null }> {
  const now = new Date().toISOString();
  const { subject } = attributionFromCtx(ctx);
  if (!subject) throw new ValidationError("A human owner is required to approve an OAuth connection");
  let grant = await oauthRepo.findActiveGrantForClient(env.DB, client.id);
  if (!grant) {
    const candidate: OauthGrantRecord = {
      id: crypto.randomUUID(),
      client_id: client.id,
      scopes_json: JSON.stringify(scopes),
      owner_email: subject.email,
      owner_display_name: subject.displayName,
      created_at: now,
      last_used_at: null,
      revoked_at: null,
    };
    // The partial unique index makes concurrent approval requests converge on
    // one active connection. The loser loads and reuses the winner's grant.
    if (await oauthRepo.insertGrant(env.DB, {
      id: candidate.id,
      clientId: client.id,
      scopesJson: candidate.scopes_json,
      ownerEmail: candidate.owner_email!,
      ownerDisplayName: candidate.owner_display_name,
      now,
    })) {
      grant = candidate;
    } else {
      grant = await oauthRepo.findActiveGrantForClient(env.DB, client.id);
      if (!grant) throw new Error("Active OAuth grant disappeared during approval");
    }
  }
  if (!grant) throw new Error("Active OAuth grant disappeared during approval");
  const merged = unionScopes(parseScopesJson(grant.scopes_json), scopes);
  if (JSON.stringify(merged) !== grant.scopes_json) {
    await oauthRepo.updateGrantScopes(env.DB, grant.id, JSON.stringify(merged));
  }
  await recordAudit(ctx, {
    action: "oauth_grant.approve",
    entityType: "oauth_grant",
    entityId: grant.id,
    after: { client_id: client.client_id, client_name: client.client_name, scopes, redirect_uri: redirectUri },
  });

  const code = randomToken(OAUTH_AUTH_CODE_PREFIX);
  await oauthRepo.insertCode(env.DB, {
    codeHash: await sha256Hex(code),
    clientId: client.id,
    grantId: grant.id,
    redirectUri,
    codeChallenge,
    scopesJson: JSON.stringify(scopes),
    resource,
    expiresAt: new Date(Date.now() + OAUTH_AUTH_CODE_TTL_MS).toISOString(),
    now,
  });
  return { code, redirectUri, state };
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
  resource: string;
}

async function issueTokenPair(
  env: Env,
  grantId: string,
  clientId: string,
  scopes: McpScope[],
  resource: string,
  rotatedFromHash: string | null,
): Promise<TokenResponse> {
  const now = new Date().toISOString();
  const access = randomToken(OAUTH_ACCESS_TOKEN_PREFIX);
  const refresh = randomToken(OAUTH_REFRESH_TOKEN_PREFIX);
  const accessHash = await sha256Hex(access);
  const refreshHash = await sha256Hex(refresh);
  const scopesJson = JSON.stringify(scopes);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO oauth_tokens (token_hash, kind, grant_id, client_id, scopes_json, resource, expires_at, rotated_from_hash, revoked_at, created_at, last_used_at)
       VALUES (?, 'access', ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
    ).bind(accessHash, grantId, clientId, scopesJson, resource, new Date(Date.now() + OAUTH_ACCESS_TOKEN_TTL_MS).toISOString(), now),
    env.DB.prepare(
      `INSERT INTO oauth_tokens (token_hash, kind, grant_id, client_id, scopes_json, resource, expires_at, rotated_from_hash, revoked_at, created_at, last_used_at)
       VALUES (?, 'refresh', ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    ).bind(refreshHash, grantId, clientId, scopesJson, resource, new Date(Date.now() + OAUTH_REFRESH_TOKEN_TTL_MS).toISOString(), rotatedFromHash, now),
  ]);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refresh,
    scope: scopes.join(" "),
    resource,
  };
}

export async function exchangeAuthorizationCode(
  env: Env,
  params: { code?: string; redirect_uri?: string; client_id?: string; code_verifier?: string },
): Promise<TokenResponse> {
  const { code, redirect_uri, client_id, code_verifier } = params;
  if (!code || !redirect_uri || !client_id || !code_verifier) {
    throw new OAuthError("invalid_request", 400, "code, redirect_uri, client_id, and code_verifier are required");
  }
  const record = await oauthRepo.getCodeByHash(env.DB, await sha256Hex(code));
  if (!record || record.consumed_at || record.expires_at <= new Date().toISOString()) {
    throw new OAuthError("invalid_grant", 400, "Authorization code is unknown, expired, or already used");
  }
  const client = await oauthRepo.getClientByClientId(env.DB, client_id);
  if (!client || client.id !== record.client_id || record.redirect_uri !== redirect_uri) {
    throw new OAuthError("invalid_grant", 400, "Authorization code was not issued to this client or redirect URI");
  }
  if (!(await verifyPkce(code_verifier, record.code_challenge))) {
    throw new OAuthError("invalid_grant", 400, "PKCE verification failed");
  }
  // Atomic single-use consumption; the race loser gets invalid_grant.
  const consumed = await oauthRepo.consumeCode(env.DB, record.code_hash, new Date().toISOString());
  if (!consumed) throw new OAuthError("invalid_grant", 400, "Authorization code is already used");

  const grant = await oauthRepo.getGrantById(env.DB, record.grant_id);
  if (!grant || grant.revoked_at) {
    throw new OAuthError("invalid_grant", 400, "Grant is revoked");
  }
  await oauthRepo.touchGrant(env.DB, grant.id, new Date().toISOString());

  const scopes = parseScopesJson(record.scopes_json);
  return issueTokenPair(env, grant.id, client.id, scopes, record.resource, null);
}

export async function exchangeRefreshToken(
  env: Env,
  params: { refresh_token?: string; client_id?: string; scope?: string },
): Promise<TokenResponse> {
  const { refresh_token, client_id } = params;
  if (!refresh_token || !client_id) {
    throw new OAuthError("invalid_request", 400, "refresh_token and client_id are required");
  }
  const record = await oauthRepo.getTokenWithContext(env.DB, await sha256Hex(refresh_token));
  if (!record || record.kind !== "refresh" || record.expires_at <= new Date().toISOString()) {
    throw new OAuthError("invalid_grant", 400, "Refresh token is unknown or expired");
  }
  const client = await oauthRepo.getClientByClientId(env.DB, client_id);
  if (!client || client.id !== record.client_id) {
    throw new OAuthError("invalid_grant", 400, "Refresh token was not issued to this client");
  }
  if (record.grant_revoked_at) {
    throw new OAuthError("invalid_grant", 400, "Grant is revoked");
  }
  if (record.revoked_at) {
    // A revoked but still-active-grant refresh token was already rotated. Its
    // reuse is a replay signal, so invalidate the whole token family before
    // returning invalid_grant to prevent an attacker continuing the chain.
    await oauthRepo.revokeGrantAndTokens(env.DB, record.grant_id, new Date().toISOString());
    throw new OAuthError("invalid_grant", 400, "Refresh token replay detected");
  }
  // Scopes can never expand beyond the owner-approved grant scopes.
  const grantScopes = parseScopesJson(record.scopes_json);
  let scopes = grantScopes;
  if (params.scope !== undefined && params.scope !== null && params.scope.trim() !== "") {
    let requested: McpScope[];
    try {
      requested = parseScopes(params.scope);
    } catch {
      throw new OAuthError("invalid_scope", 400, "Requested scope is invalid");
    }
    if (!requested.every((s) => grantScopes.includes(s))) {
      throw new OAuthError("invalid_scope", 400, "Requested scope exceeds the approved grant");
    }
    scopes = requested;
  }

  // Atomic rotation: burn the presented refresh token, then issue a new pair.
  const now = new Date().toISOString();
  const rotated = await oauthRepo.revokeToken(env.DB, record.token_hash, now);
  if (!rotated) {
    // A concurrent redemption won the rotation race; treat this as replay.
    await oauthRepo.revokeGrantAndTokens(env.DB, record.grant_id, now);
    throw new OAuthError("invalid_grant", 400, "Refresh token replay detected");
  }
  await oauthRepo.touchGrant(env.DB, record.grant_id, now);

  return issueTokenPair(env, record.grant_id, client.id, scopes, record.resource, record.token_hash);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function parseScopesJson(scopesJson: string): McpScope[] {
  try {
    const parsed = JSON.parse(scopesJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is McpScope => typeof s === "string" && MCP_SCOPES.includes(s as McpScope));
  } catch {
    return [];
  }
}

export function parseAuthorizeQuery(search: URLSearchParams): AuthorizeParams {
  return {
    clientId: search.get("client_id") ?? "",
    redirectUri: search.get("redirect_uri") ?? "",
    responseType: search.get("response_type") ?? "",
    state: search.get("state"),
    codeChallenge: search.get("code_challenge") ?? "",
    codeChallengeMethod: search.get("code_challenge_method") ?? "",
    scope: search.get("scope") ?? undefined,
    resource: search.get("resource") ?? undefined,
  };
}

export function parseAuthorizeForm(form: Record<string, string | File>): AuthorizeParams {
  const get = (k: string) => (typeof form[k] === "string" ? (form[k] as string) : "");
  return {
    clientId: get("client_id"),
    redirectUri: get("redirect_uri"),
    responseType: get("response_type"),
    state: get("state") || null,
    codeChallenge: get("code_challenge"),
    codeChallengeMethod: get("code_challenge_method"),
    scope: get("scope") || undefined,
    resource: get("resource") || undefined,
  };
}

export function validateRegistrationInput(raw: unknown): {
  redirect_uris: unknown;
  client_name: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  token_endpoint_auth_method?: unknown;
} {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ValidationError("Registration body must be a JSON object");
  }
  const body = raw as Record<string, unknown>;
  return {
    redirect_uris: body.redirect_uris,
    client_name: body.client_name,
    grant_types: body.grant_types,
    response_types: body.response_types,
    token_endpoint_auth_method: body.token_endpoint_auth_method,
  };
}
