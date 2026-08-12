/**
 * Cloudflare Access authentication for the web/API hostname.
 *
 * Every web/API request must carry a `Cf-Access-Jwt-Assertion` header issued
 * by the configured Access team for the configured audience, and the asserted
 * email must equal the configured workspace owner.
 *
 * Local development (no ACCESS_TEAM/ACCESS_AUD configured) uses AUTH_DEV_EMAIL
 * as the identity. If neither is configured, all requests are rejected
 * (fail closed).
 */
import type { Env } from "../../env";
import { AuthError, ForbiddenError } from "../../domain/errors";

export interface AccessIdentity {
  email: string;
  type: "human";
}

interface Jwk {
  kid?: string;
  kty: string;
  n: string;
  e: string;
}

interface Jwks {
  keys: Jwk[];
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

export async function authenticateAccess(env: Env, request: Request, fetchImpl?: typeof fetch): Promise<AccessIdentity> {
  if (env.ACCESS_TEAM || env.ACCESS_AUD) {
    // Fail closed on partial configuration: setting only one of the two
    // Access variables must never degrade into the development identity or a
    // skipped owner check.
    if (!env.ACCESS_TEAM || !env.ACCESS_AUD) {
      throw new AuthError("Incomplete Cloudflare Access configuration (ACCESS_TEAM and ACCESS_AUD must both be set)");
    }
    const header = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!header) throw new AuthError("Missing Cloudflare Access JWT");
    const payload = await verifyAccessJwt(header, { team: env.ACCESS_TEAM, aud: env.ACCESS_AUD, fetchImpl });
    const email =
      typeof payload.email === "string" && payload.email
        ? payload.email
        : typeof payload.common_name === "string"
          ? payload.common_name
          : "";
    if (!email) throw new AuthError("Access JWT carries no identity");
    // Fail closed: a missing owner email must never widen access to any
    // identity the Access application happens to admit.
    if (!env.OWNER_EMAIL) throw new AuthError("OWNER_EMAIL is not configured");
    if (email !== env.OWNER_EMAIL) {
      throw new ForbiddenError("Identity is not the workspace owner");
    }
    return { email, type: "human" };
  }
  if (env.AUTH_DEV_EMAIL) {
    return { email: env.AUTH_DEV_EMAIL, type: "human" };
  }
  throw new AuthError("No authentication configured for this environment");
}

export interface JwtVerifyOptions {
  team: string;
  aud: string;
  fetchImpl?: typeof fetch;
  now?: number;
}

export async function verifyAccessJwt(token: string, opts: JwtVerifyOptions): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Malformed JWT");
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { kid?: string; alg?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64urlToString(headerB64)) as { kid?: string; alg?: string };
    payload = JSON.parse(base64urlToString(payloadB64)) as Record<string, unknown>;
  } catch {
    throw new AuthError("Malformed JWT");
  }
  if (header.alg !== "RS256") throw new AuthError("Unsupported JWT algorithm");

  const keys = await fetchJwks(opts);
  const key = keys.keys.find((k) => k.kid === header.kid);
  if (!key) throw new AuthError("Unknown JWT signing key");

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { kty: key.kty, n: key.n, e: key.e, alg: "RS256", use: "sig" },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    base64urlToBytes(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new AuthError("Invalid JWT signature");

  const now = opts.now ?? Date.now();
  const exp = typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  if (exp <= now) throw new AuthError("JWT expired");

  const aud = payload.aud;
  const audiences = Array.isArray(aud) ? aud.map(String) : [String(aud)];
  if (!audiences.includes(opts.aud)) throw new AuthError("JWT audience mismatch");

  if (payload.iss !== `https://${opts.team}`) throw new AuthError("JWT issuer mismatch");

  return payload;
}

async function fetchJwks(opts: JwtVerifyOptions): Promise<Jwks> {
  const cached = jwksCache.get(opts.team);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return { keys: cached.keys };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`https://${opts.team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new AuthError("Unable to fetch Cloudflare Access signing keys");
  const jwks = (await res.json()) as Jwks;
  if (!Array.isArray(jwks.keys)) throw new AuthError("Malformed JWKS response");
  jwksCache.set(opts.team, { keys: jwks.keys, fetchedAt: Date.now() });
  return jwks;
}

export function base64urlToString(input: string): string {
  const binary = atob(input.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const binary = atob(input.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
