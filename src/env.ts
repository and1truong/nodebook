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
  /** Initial calendar view: "day", "week", or "month" (default "week"). */
  CALENDAR_DEFAULT_VIEW?: string;
  /** First day of the calendar week: "sunday"…"saturday" (default "sunday"). */
  WEEK_START_DAY?: string;
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
