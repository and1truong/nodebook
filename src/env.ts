/** Worker environment bindings and configuration. */
import type { D1Database, DurableObjectNamespace, R2Bucket } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  MCP_SESSION: DurableObjectNamespace;
  /** Static asset binding; absent in test/other contexts. */
  ASSETS?: Fetcher;

  // Configuration (wrangler.jsonc vars; override in production).
  OWNER_EMAIL: string;
  OWNER_TIMEZONE: string;
  /** Cloudflare Access team domain, e.g. "example.cloudflareaccess.com". */
  ACCESS_TEAM: string;
  /** Cloudflare Access application audience tag. */
  ACCESS_AUD: string;
  /** Development-only identity. Never set this in production. */
  AUTH_DEV_EMAIL: string;
  /** Browser upload limit in bytes (string from wrangler vars). */
  MAX_UPLOAD_BYTES: string;
  /** MCP attach_file limit in bytes (string). */
  MCP_MAX_UPLOAD_BYTES: string;
  /** Allowed CORS origins for /mcp (comma separated); empty = "*". */
  MCP_CORS_ORIGINS?: string;
  /**
   * Public HTTPS origin of the OAuth authorization server, e.g.
   * "https://nb.phucam.tv". Must be the stable custom domain — never
   * workers.dev. Discovery and resource metadata are anchored to this value
   * so they never depend on an untrusted request host.
   */
  OAUTH_ISSUER?: string;
  /** Initial calendar view: "day", "week", or "month" (default "week"). */
  CALENDAR_DEFAULT_VIEW?: string;
  /** First day of the calendar week: "sunday"…"saturday" (default "sunday"). */
  WEEK_START_DAY?: string;
  /** Initial number of rows on the Issues page: "20", "50", or "100" (default 20). */
  ISSUES_DEFAULT_LIMIT?: string;
}

export function uploadLimitBytes(env: Env): number {
  const n = Number(env.MAX_UPLOAD_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 25 * 1024 * 1024;
}

export function mcpUploadLimitBytes(env: Env): number {
  const n = Number(env.MCP_MAX_UPLOAD_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 5 * 1024 * 1024;
}

export function ownerTimezone(env: Env): string {
  return env.OWNER_TIMEZONE && env.OWNER_TIMEZONE.trim() ? env.OWNER_TIMEZONE : "UTC";
}

/**
 * The OAuth issuer origin: the configured OAUTH_ISSUER (production) or the
 * request origin (local development). Trailing slashes are normalized away.
 */
export function oauthIssuer(env: Env, request?: Request): string {
  const configured = env.OAUTH_ISSUER?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (request) return new URL(request.url).origin;
  return "";
}

/** OAuth resource indicator for the MCP endpoint of this issuer. */
export function oauthResource(env: Env, request?: Request): string {
  return `${oauthIssuer(env, request)}/mcp`;
}
