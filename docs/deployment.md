# NodeBook Deployment Runbook

## Topology

```
Cloudflare Access ──▶ nodebook.<your-domain> ──▶ Worker (Hono + assets)
                                                     ├── D1  "nodebook"
                                                     ├── R2  "nodebook-files"
                                                     ├── DO  "McpSession"
                                                     └── Cron: * * * * *  (reminders)
                                                          0 3 * * *  (attachment GC)
MCP clients ──▶ https://nodebook.<your-domain>/mcp   (PAT or OAuth; bypasses Access)
OAuth clients ──▶ /.well-known/oauth-*, /oauth/register, /oauth/token   (public)
Owner browser ──▶ /oauth/authorize   (behind Access: consent for OAuth connections)
```

## 1. Provision resources

```bash
npm ci

# D1 database
npx wrangler d1 create nodebook              # note the database_id

# R2 bucket
npx wrangler r2 bucket create nodebook-files
```

For a personal deployment, keep the checked-in `wrangler.jsonc` unchanged. It
contains the `database_id: "local"` placeholder so it is safe for forks. Make a
private copy instead (it is gitignored), replace the `DB` binding's
`database_id` with the UUID printed by `d1 create`, and change `bucket_name` if
you chose a different R2 bucket:

```bash
cp wrangler.jsonc wrangler.personal.jsonc
# Edit wrangler.personal.jsonc: set d1_databases[0].database_id to your UUID.
npx wrangler d1 migrations apply DB --remote --config wrangler.personal.jsonc
```

A D1 database ID is not a credential, but it is deployment-specific: committing
yours to this public repo would make its default Worker binding point to your
personal database. Do not add a second D1 entry with the same
`database_name`; replace the `database_id` on the existing `DB` binding.

For Git-integration deploys (§5), the real `database_id` must be in the config
file used by that build. Use a private fork/repository with your personal config
committed, or deploy from your machine with `--config wrangler.personal.jsonc`.

## 2. Configure the Worker

Set these variables (dashboard → Workers → nodebook → Settings → Variables, or `wrangler secret put` / `wrangler deploy --var`):

| Variable | Required | Meaning |
| --- | --- | --- |
| `OWNER_EMAIL` | yes | The single human owner; Access assertions must match it |
| `OWNER_TIMEZONE` | yes | IANA timezone for planning views when the client sends none |
| `ACCESS_TEAM` | yes | e.g. `example.cloudflareaccess.com` |
| `ACCESS_AUD` | yes | Your Access application audience tag |
| `AUTH_DEV_EMAIL` | **never in prod** | Dev-only fallback identity; unset it |
| `MAX_UPLOAD_BYTES` | no | Browser upload limit (default 26214400 = 25 MB) |
| `MCP_MAX_UPLOAD_BYTES` | no | MCP attach_file limit (default 5242880 = 5 MB) |
| `MCP_CORS_ORIGINS` | no | Comma-separated origins allowed on `/mcp` (default `*`) |
| `OAUTH_ISSUER` | **yes in prod** | Public HTTPS origin of the OAuth authorization server, e.g. `https://nodebook.example.com`. Must be the stable custom domain — never `workers.dev`. Changing it after OAuth clients have connected breaks discovery and redirect validation. |
| `CALENDAR_DEFAULT_VIEW` | no | Initial calendar view: `day`, `week`, or `month` (missing/invalid values fall back to `week`) |
| `WEEK_START_DAY` | no | First day of the calendar week: `sunday`–`saturday`, lowercase (missing/invalid values fall back to `sunday`). Rotates Calendar views, date pickers, and the Inbox/Calendar **Next week** shortcuts after a reload |
| `ISSUES_DEFAULT_LIMIT` | no | Initial `/issues` page size: `20`, `50`, or `100` (missing/invalid values fall back to `20`); users can change it in the list footer |

## 3. Cloudflare Access (web + API)

1. Zero Trust → Access → Applications → Add an application → Self-hosted.
2. Domain: `nodebook.<your-domain>` (the Worker's custom domain or route).
3. Add the Worker route (Workers → nodebook → Settings → Domains & Routes) so `https://nodebook.<your-domain>` hits the Worker.
4. Policy: **Allow** with the include rule `Emails → OWNER_EMAIL`.
5. Copy the **Application Audience (AUD) Tag** into `ACCESS_AUD`; `ACCESS_TEAM` is the team domain (e.g. `example.cloudflareaccess.com`).

The Worker verifies each request's `Cf-Access-Jwt-Assertion` (RS256, JWKS fetched from `https://<team>/cdn-cgi/access/certs`, cached 1 h), checks the audience, expiry, issuer, and that the asserted email equals `OWNER_EMAIL`.

> **MCP and OAuth routes.** `/mcp`, `/.well-known/oauth-*`, `/oauth/register`, and `/oauth/token` deliberately bypass Access — ChatGPT and other OAuth clients cannot send a Cloudflare Access JWT. They still reject every request without valid credentials (bearer PAT/OAuth token at `/mcp`; registered redirect URI + PKCE at the OAuth endpoints). Do **not** protect them with an Access policy.
>
> `/oauth/authorize` **must** stay behind Access: it is the owner-facing consent page. In the Access application policy, add exclude rules (Bypass) for these paths, or scope a second application to `/oauth/authorize`:
>
> ```text
> Exclude (Bypass):
>   /mcp
>   /.well-known/oauth-authorization-server
>   /.well-known/oauth-protected-resource/mcp
>   /oauth/register
>   /oauth/token
> ```
>
> With `OAUTH_ISSUER` set to the same custom domain, every authorization request is anchored to the configured origin, so a spoofed Host header cannot redirect codes or mint tokens for a different resource.

## 4. Security checklist

- [ ] `workers.dev` disabled or left unexposed; production uses a custom domain under Access.
- [ ] `AUTH_DEV_EMAIL` empty in production.
- [ ] `ACCESS_TEAM` + `ACCESS_AUD` set (fail-closed otherwise).
- [ ] `OAUTH_ISSUER` set to the stable custom domain (never `workers.dev`); unchanged after clients connect.
- [ ] Access policy excludes `/mcp`, `/.well-known/oauth-*`, `/oauth/register`, `/oauth/token`; `/oauth/authorize` and `/api/*` remain protected.
- [ ] MCP tokens created with the minimal scopes needed; expired or unused tokens revoked.
- [ ] OAuth redirect URIs are exact HTTPS URLs (no wildcards, no fragments); consent is required per client, and connections are revoked when no longer used.
- [ ] Attachment upload limits set to something reasonable for your plan (R2 egress is metered).

## 5. CI/CD

### Continuous integration — GitHub Actions

`.github/workflows/ci.yml` runs on every pull request and every push to `main`.
One job (`validate`) on `ubuntu-latest` — free for public repositories — runs
every gate in order and fails fast on the first red step:

```text
push (main) / pull_request
        │
        ▼
checkout → setup-node (Node 22, npm cache) → npm ci
  → npm run lint → npm run typecheck → npm test → npm run build
  → npm run test:integration
  → playwright install chromium → npm run test:e2e
  → npx wrangler deploy --dry-run
```

- `npm ci` installs exactly from `package-lock.json` (frozen lockfile) and
  fails if the lockfile and `package.json` drift.
- The final `wrangler deploy --dry-run` is a packaging/bindings pre-flight
  check; it needs no Cloudflare credentials.
- A red check blocks merge. CI only validates — it never deploys.

### Continuous deployment — Cloudflare Git integration (Workers Builds)

Production deploys come from Cloudflare's Git integration, not from GitHub
Actions. Every push to `main` triggers a build in Cloudflare's infrastructure
that runs the configured build and deploy commands against this repository:

```text
push to main ──▶ GitHub Actions: validate (above)
             └─▶ Cloudflare Git integration: build → deploy ──▶ production Worker
```

### Dashboard setup (one-time; cannot live in the repo)

Before connecting the repository, everything the deploy references must exist
on the account (§1–§3): D1 `nodebook` and R2 `nodebook-files` created, and the
custom domain and Access application in place. Git integration reads the
repository's `wrangler.jsonc`, so configure it only in a private fork/repository
for a personal deployment: replace the `"local"` placeholder with that account's
D1 ID. Wrangler treats the config as the source of truth, so a dashboard binding
override is not a reliable way to supply the ID.

Then connect and configure (Workers → nodebook → Settings → Builds):

| Field | Value |
| --- | --- |
| Repository | `and1truong/nodebook` |
| Production branch | `main` (default; under *Branch control*) |
| Root directory | `/` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch builds (PR previews) | **off** (default) — this repo deploys only from `main`; previews would need their own D1/R2 and Access setup |

Optional: prefix the deploy command with `npx wrangler d1 migrations apply
nodebook --remote &&` to auto-apply schema on every deploy. Keep the default
(manual migrations) unless you accept the risk — §6 requires a D1 backup
before migrating, which an automatic deploy step cannot do for you.

The worker name in the dashboard must match the `name` in `wrangler.jsonc`
(`nodebook`) or builds fail. After connecting, push to `main` and watch
Deployments → View build history for the first build — it deploys the current
`main`, so apply pending D1 migrations manually first (§6), with a backup.

### Secrets, vars, and deploys

Secrets stay out of Git: set them with `wrangler secret put` (survives every
deploy) or in the dashboard (Settings → Variables & Secrets). Note that
plaintext vars in `wrangler.jsonc` **overwrite** dashboard-set vars on every
`wrangler deploy` (including Git-integration deploys), so set the production
values for `OWNER_EMAIL`, `ACCESS_TEAM`, and `ACCESS_AUD` as secrets, or via
`--var` on the deploy command — not as dashboard-only plaintext vars.
`AUTH_DEV_EMAIL` may stay as-is in the config: the dev fallback identity is
only used when `ACCESS_TEAM`/`ACCESS_AUD` are not both set (§2's fail-closed
rule), but empty it in production anyway if you want belt and braces.

`npm run deploy` remains the manual/staging path — the same build + deploy
commands the Git integration runs, but from your machine.

## 6. Deploy

```bash
npm run build                          # client bundle → dist/
npx wrangler d1 migrations apply DB --remote --config wrangler.personal.jsonc
npm run deploy -- --config wrangler.personal.jsonc
npx wrangler deploy --dry-run --config wrangler.personal.jsonc
```

Deploying to staging first is strongly recommended: apply migrations there, smoke-test, then promote. D1 rollback is not assumed — **back up before migrating**:

```bash
npx wrangler d1 export DB --remote --config wrangler.personal.jsonc --output backup-$(date +%F).sql
```

## 7. Cron & scheduled behavior

- `* * * * *` — `processDueReminders`: claims due deliveries (expiring 5-minute locks), inserts in-app notifications under idempotency keys, advances recurring reminders.
- `0 3 * * *` — attachment garbage collection: soft-deleted rows past 24 h whose R2 blob has no active references.

**MVP SLA:** reminders are delivered within one Cron interval plus Cloudflare scheduling delay (minute-level, not second-level). Delivery timestamps are stored on each occurrence; check `reminder_occurrences` for evidence.

## 8. Smoke test after deploy

```bash
curl -s https://nodebook.<domain>/healthz                    # {"ok":true}
curl -s https://nodebook.<domain>/api/me                     # 401 without Access; owner email through Access
# OAuth discovery:
curl -s https://nodebook.<domain>/.well-known/oauth-authorization-server
curl -s https://nodebook.<domain>/.well-known/oauth-protected-resource/mcp
# MCP (personal access token):
TOKEN=$(… create via Settings → MCP tokens …)
curl -s -X POST https://nodebook.<domain>/mcp \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

Then: create an issue with a due date, add a before-due reminder, wait for the minute tick, and confirm the notification appears in the inbox. Revoke the MCP token and confirm the next MCP call returns 401. Upload a private file and confirm the content URL returns 401 to an unauthenticated curl.

## 9. ChatGPT connector setup (OAuth)

ChatGPT’s connector UI cannot send a user-entered bearer PAT, so it uses the built-in OAuth flow. No tunnel is required — the Worker is the authorization server.

1. **Settings → MCP tokens** (or just connect — the consent page appears automatically).
2. In ChatGPT, **Add connector → MCP server**, and set only:
   ```text
   MCP URL:  https://nodebook.example.com/mcp
   OAuth:    ✓ (the default; do not paste a bearer token)
   ```
   ChatGPT discovers the authorization server from the `401` challenge (`resource_metadata`) and/or the well-known metadata, and registers itself as an OAuth client.
3. ChatGPT opens the authorization page in your browser. Complete the **Cloudflare Access** login, then review the **NodeBook consent page** (client name, resource `https://nodebook.example.com/mcp`, requested scopes) and click **Approve**.
4. Back in ChatGPT, the connector connects with the short-lived access token; refresh tokens rotate automatically. Tools are listed after approval — invoke a read tool to confirm.
5. To cut off the connector at any time: **Settings → MCP tokens → OAuth connections → revoke**. Revocation invalidates the access token and all refresh tokens immediately; ChatGPT’s next tool call fails until it re-authorizes.

Manual verification checklist:
- [ ] Tools are listed after approval (no tunnel, no PAT).
- [ ] Revoking the OAuth connection breaks subsequent tool calls immediately.
- [ ] The connection appears in Settings with its approved scopes and last-use time.
- [ ] `oauth_grant.approve` / `oauth_grant.revoke` audit events are recorded for the grant.

## 10. Operations

- **Search index repair:** `DELETE FROM search_docs; UPDATE meta SET value='' WHERE key='search_rebuilt_at';` then trigger a rebuild — or call `rebuildSearchIndex` via a one-off script. The index is also maintained incrementally on every mutation.
- **Monitoring:** enable `observability` (already in `wrangler.jsonc`) for Workers Logs/Metrics; alarm on 5xx and on `reminder_occurrences.status='failed'` rows.
- **Backups:** nightly `wrangler d1 export` (with your private `--config`) to R2 or your object store; R2 blobs are content-addressed and immutable (`blobs/<sha256>`), so they never need backing up as a set — only the attachment rows do.
- **Schema changes:** forward-compatible migrations only (additive tables/columns). Apply to staging first, back up, then apply to production.
