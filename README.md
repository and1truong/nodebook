# NodeBook

Issue-native wiki, planning, reminders, attachments, and MCP workspace — built natively on Cloudflare Workers.

Canonical PRD: https://github.com/and1truong/wiki/issues/229

## What it is

NodeBook is a single-owner workspace where every issue is a first-class node in a wiki graph:

- **Issues** — all PRD types (`task`, `bug`, `epic`, `story`, `decision`, `finding`, `incident`, `learning`, `wiki`, `note`) with open/closed state, labels, priorities, Markdown bodies, and durable audit history.
- **Graph** — parent/child hierarchy, typed relationships (`related`, `depends_on`, `blocks`, `supersedes`, `duplicates`), and `#123` references that resolve even when the target is created later.
- **Wiki** — hierarchy tree navigation, breadcrumbs, backlinks, and related-content panels.
- **Search** — FTS5 full-text search over titles, bodies, comments, labels, and attachment metadata, with type/state/label filters and PRD `search_knowledge` semantics.
- **Planning** — Inbox / Today / Upcoming / Overdue views in the owner's timezone; recurring tasks (RFC 5545 rules) record occurrences and advance planning dates instead of closing.
- **Reminders & notifications** — absolute, before-due, and recurring reminders delivered to an in-app notification inbox by a one-minute Cron Trigger, with idempotent delivery and expiring claim locks.
- **Attachments** — private R2 blobs with checksum deduplication, inline previews or forced downloads, range support, soft deletion, and daily garbage collection.
- **Theming** — light, dark, and system themes (Tailwind CSS v4 + CSS-variable tokens on shadcn/ui components) with a topbar switcher, localStorage persistence, no flash-of-wrong-theme on load, and live following of the OS preference in system mode.
- **MCP** — a Streamable HTTP MCP server on `/mcp` exposing 18 scoped read/write tools that share the exact same services, validation, and audit trail as the web UI.

## Architecture

```
Browser (React SPA) ── Cloudflare Access ──▶ Worker ──▶ D1 (domain data + FTS5)
                                              │         ├── R2 (private blobs)
MCP clients ── PAT (nbk_…) ──▶ /mcp ──▶ Durable Object (session state)
                                              │
Cron Triggers (1 min / daily) ───────────────▶ scheduled handlers
```

One TypeScript project, one deployable Worker. No Node.js runtime (`nodejs_compat` is not required). See [docs/architecture.md](docs/architecture.md), [docs/deployment.md](docs/deployment.md), and [docs/mvp-scope.md](docs/mvp-scope.md).

## Quick start

```bash
npm ci
cp .dev.vars.example .dev.vars        # local identity (owner@nodebook.local)

# Terminal 1 — the Worker (API + MCP + UI on :8787)
npm run db:migrate:local
npm run dev:worker

# Terminal 2 — the Vite dev server with API proxy (optional, hot reload on :5173)
npm run dev:web

# Or run the built SPA directly through the Worker:
npm run build                          # then just use http://localhost:8787
```

## Quality gates

```bash
npm run lint              # ESLint (source + tests)
npm run typecheck         # TypeScript strict across client, Worker, services, MCP
npm test                  # unit tests (recurrence, timezones, refs, auth, search utils)
npm run test:integration  # integration tests under the Workers runtime (D1/R2/DO)
npm run test:e2e          # Playwright acceptance flow against a local Worker
npm run build             # production client bundle
npx wrangler d1 migrations apply nodebook --local   # migrations prove clean
npx wrangler deploy --dry-run                       # packaging + bindings check
```

## CI/CD

- **CI:** `.github/workflows/ci.yml` runs every gate above (plus e2e) on every
  pull request and every push to `main` — one job on `ubuntu-latest`, failing
  fast on any red step. A red check blocks merge.
- **CD:** production deploys via Cloudflare's Git integration (Workers
  Builds): a push to `main` makes Cloudflare run `npm ci && npm run build`
  and `npx wrangler deploy` against this repo. CI never deploys.
- **Manual/staging:** `npm run deploy` runs the same build + deploy from your
  machine and remains the staging path.

The one-time Cloudflare dashboard setup (connect the repo, D1 `database_id`,
secrets) is documented in [docs/deployment.md](docs/deployment.md) §5.

## MCP

Create a scoped token in **Settings → MCP tokens**, then point any MCP client at:

```
URL:   https://<your-worker>/mcp
Auth:  Authorization: Bearer nbk_…
```

Tokens are stored as SHA-256 hashes with display prefixes, support expiration, and revoke immediately. Every tool call is re-checked against the database on each request. `get_today`/`get_upcoming` accept an optional `timezone` argument (IANA).

## Production notes

- The web/API hostname **must** be protected with Cloudflare Access (`ACCESS_TEAM` + `ACCESS_AUD`); only `/mcp` bypasses Access, and it still rejects every request without a valid scoped token.
- Disable `workers.dev` access or keep `AUTH_DEV_EMAIL` unset in production.
- Back up D1 before applying migrations (`wrangler d1 export`), and deploy migrations to staging first.
- See [docs/deployment.md](docs/deployment.md) for the full runbook.

## License

MIT — see [LICENSE](LICENSE).
