# NodeBook Deployment Runbook

## Topology

```
Cloudflare Access ──▶ nodebook.<your-domain> ──▶ Worker (Hono + assets)
                                                     ├── D1  "nodebook"
                                                     ├── R2  "nodebook-files"
                                                     ├── DO  "McpSession"
                                                     └── Cron: * * * * *  (reminders)
                                                          0 3 * * *  (attachment GC)
MCP clients ──▶ https://nodebook.<your-domain>/mcp   (PAT-protected; bypasses Access)
```

## 1. Provision resources

```bash
npm ci

# D1 database
npx wrangler d1 create nodebook              # note the database_id
npx wrangler d1 migrations apply nodebook --remote

# R2 bucket
npx wrangler r2 bucket create nodebook-files
```

Put the D1 `database_id` and the R2 `bucket_name` into `wrangler.jsonc` (the checked-in file uses placeholders `local` / `nodebook-files`). For Git-integration deploys (§5), the real `database_id` must be in the file — the deploy runs `wrangler deploy` with this repo's config, and wrangler treats the config file as the source of truth over dashboard-side bindings.

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
| `CALENDAR_DEFAULT_VIEW` | no | Initial calendar view: `day`, `week`, or `month` (missing/invalid values fall back to `week`) |
| `WEEK_START_DAY` | no | First day of the calendar week: `sunday`–`saturday`, lowercase (missing/invalid values fall back to `sunday`). Rotates Calendar views, date pickers, and the inbox **Next week** shortcut after a reload |

## 3. Cloudflare Access (web + API)

1. Zero Trust → Access → Applications → Add an application → Self-hosted.
2. Domain: `nodebook.<your-domain>` (the Worker's custom domain or route).
3. Add the Worker route (Workers → nodebook → Settings → Domains & Routes) so `https://nodebook.<your-domain>` hits the Worker.
4. Policy: **Allow** with the include rule `Emails → OWNER_EMAIL`.
5. Copy the **Application Audience (AUD) Tag** into `ACCESS_AUD`; `ACCESS_TEAM` is the team domain (e.g. `example.cloudflareaccess.com`).

The Worker verifies each request's `Cf-Access-Jwt-Assertion` (RS256, JWKS fetched from `https://<team>/cdn-cgi/access/certs`, cached 1 h), checks the audience, expiry, issuer, and that the asserted email equals `OWNER_EMAIL`.

> **MCP route.** `/mcp` deliberately bypasses Access. It must still reject every request without a valid `nbk_…` token (it does — verified per request against D1). Do **not** protect `/mcp` with an Access policy, or MCP clients cannot connect.

## 4. Security checklist

- [ ] `workers.dev` disabled or left unexposed; production uses a custom domain under Access.
- [ ] `AUTH_DEV_EMAIL` empty in production.
- [ ] `ACCESS_TEAM` + `ACCESS_AUD` set (fail-closed otherwise).
- [ ] MCP tokens created with the minimal scopes needed; expired or unused tokens revoked.
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
on the account (§1–§3): D1 `nodebook` and R2 `nodebook-files` created, the
custom domain and Access application in place, and the real D1 `database_id`
in `wrangler.jsonc` (replace the `"local"` placeholder — a database ID is not
a credential). The Git-integration deploy runs `npx wrangler deploy` with this
repo's config, and wrangler overwrites dashboard-side bindings from the config
file, so a dashboard binding override is not a reliable way to supply the D1
ID — edit the file instead.

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
npx wrangler d1 migrations apply nodebook --remote   # apply schema first
npm run deploy                         # vite build + wrangler deploy
npx wrangler deploy --dry-run          # pre-flight packaging check
```

Deploying to staging first is strongly recommended: apply migrations there, smoke-test, then promote. D1 rollback is not assumed — **back up before migrating**:

```bash
npx wrangler d1 export nodebook --remote --output backup-$(date +%F).sql
```

## 7. Cron & scheduled behavior

- `* * * * *` — `processDueReminders`: claims due deliveries (expiring 5-minute locks), inserts in-app notifications under idempotency keys, advances recurring reminders.
- `0 3 * * *` — attachment garbage collection: soft-deleted rows past 24 h whose R2 blob has no active references.

**MVP SLA:** reminders are delivered within one Cron interval plus Cloudflare scheduling delay (minute-level, not second-level). Delivery timestamps are stored on each occurrence; check `reminder_occurrences` for evidence.

## 8. Smoke test after deploy

```bash
curl -s https://nodebook.<domain>/healthz                    # {"ok":true}
curl -s https://nodebook.<domain>/api/me                     # 401 without Access; owner email through Access
# MCP:
TOKEN=$(… create via Settings → MCP tokens …)
curl -s -X POST https://nodebook.<domain>/mcp \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

Then: create an issue with a due date, add a before-due reminder, wait for the minute tick, and confirm the notification appears in the inbox. Revoke the MCP token and confirm the next MCP call returns 401. Upload a private file and confirm the content URL returns 401 to an unauthenticated curl.

## 9. Operations

- **Search index repair:** `DELETE FROM search_docs; UPDATE meta SET value='' WHERE key='search_rebuilt_at';` then trigger a rebuild — or call `rebuildSearchIndex` via a one-off script. The index is also maintained incrementally on every mutation.
- **Monitoring:** enable `observability` (already in `wrangler.jsonc`) for Workers Logs/Metrics; alarm on 5xx and on `reminder_occurrences.status='failed'` rows.
- **Backups:** nightly `wrangler d1 export` to R2 or your object store; R2 blobs are content-addressed and immutable (`blobs/<sha256>`), so they never need backing up as a set — only the attachment rows do.
- **Schema changes:** forward-compatible migrations only (additive tables/columns). Apply to staging first, back up, then apply to production.
