# NodeBook Architecture

## Principles

- **One TypeScript project, one deployable.** React/Vite renders the client; Hono routes HTTP on the Worker; Workers static assets serve the SPA from the same deployment. No monorepo, no separate API host.
- **Web Platform APIs only.** No `nodejs_compat`: no filesystem, no sockets, no Node server. Dependencies are pure-JS (hono, zod, marked, dompurify) or Workers-native.
- **Single shared domain layer.** HTTP routes, MCP tools, and scheduled handlers all call the same services (`src/server/services/*`) against the same repositories (`src/server/repositories/*`). Validation (zod schemas in `src/shared/contracts/`) and audit records are therefore identical across transports.
- **D1 is the source of truth; R2 holds bytes; FTS5 indexes text.** Because D1 and R2 cannot join a transaction, all destructive paths are idempotent: soft deletion + grace periods + a daily garbage collector.
- **Explicit actors.** Every mutation requires an actor context (`human` via Cloudflare Access, `mcp` via PAT, `system` for cron) and records immutable before/after audit payloads.

## Request paths

| Path | Auth | Handler |
| --- | --- | --- |
| `/api/*` | Cloudflare Access JWT, email must equal `OWNER_EMAIL` | Hono REST routes |
| `/mcp` | `Authorization: Bearer nbk_…` (SHA-256 lookup per request) | Streamable HTTP MCP → session Durable Object |
| everything else | — | `ASSETS` binding (SPA with history fallback) |
| `scheduled()` | — | Cron: `* * * * *` reminders, `0 3 * * *` attachment GC |

Auth is fail-closed: with neither `ACCESS_TEAM`/`ACCESS_AUD` nor `AUTH_DEV_EMAIL` configured, all API requests are rejected. `AUTH_DEV_EMAIL` must never be set in production.

## Data model (D1 migrations)

- `0001_core.sql` — `issues` (global sequential `number` allocated via a single `UPDATE meta … RETURNING`), `labels`, `issue_labels`, `comments`, `relationships` (directional, unique per source/target/type), `issue_references` (`#123` with nullable `target_issue_id` for late resolution; the table is named `issue_references` because `references` is a SQLite keyword), `audit_events`, `mcp_tokens` (hash + prefix + scopes).
- `0002_graph.sql` — `issue_stats` view (child/backlink counts) powering wiki navigation.
- `0003_search.sql` — `search_docs` FTS5 table (`porter unicode61`). `labels` and `attachment_meta` are indexed columns so they participate in MATCH; entity/issue ids are `UNINDEXED`.
- `0004_planning.sql` — `occurrences` (recurring-task completions, unique per issue+instant).
- `0005_reminders.sql` — `reminders`, `reminder_occurrences` (materialized deliveries with expiring claim locks), `notifications`, `notification_deliveries` (idempotency keys).
- `0006_attachments.sql` — `attachments` metadata (soft-delete + R2 key = blob checksum).

## Key algorithms

### Issue numbering
`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'issue_seq' RETURNING value` — a single atomic statement, so concurrent creates can never observe the same number (covered by an integration test).

### Recurrence (src/shared/recurrence.ts)
RFC 5545 subset: `FREQ=DAILY|WEEKLY|MONTHLY`, `INTERVAL`, `BYDAY` (daily/weekly), `COUNT`, `UNTIL`. All math is civil-time in the issue's IANA timezone via `Intl.DateTimeFormat`:

- `instantFromCivil` resolves DST gaps/overlaps deterministically (gap times land on the post-transition instant; overlaps pick the first occurrence).
- Weekly rules advance from the anchor week; monthly rules preserve the anchor day-of-month, clamped to month length.
- `COUNT` is enforced across repeated completions: the service counts recorded occurrences and passes the initial ordinal into `nextOccurrence`.

Completing a recurring task records an occurrence and advances `start_date`/`due_date`/`scheduled_date` from the **last planned occurrence** (not "now"), so early or late completion still rolls the series by exactly one interval. Non-recurring tasks close normally.

### Sub-issue tree (GitHub-style panel)
`GET /api/graph/:ref/sub-issues` returns the full descendant tree of one issue as recursive `SubIssueNodeDto`s (id, number, title, status, parent_id, children) in one `WITH RECURSIVE` D1 query over `idx_issues_parent` — no client waterfalls, no full-wiki fetch. Rows are globally ordered by the sequential issue number, so assembling by parent yields deterministic sibling ordering. The legacy `GET /api/graph/:ref/children` (flat, full `IssueDto`s) is retained for compatibility. The panel's completion progress is **closed direct children / total direct children** per node, matching GitHub's nested progress badges; it is computed client-side from the tree, so no aggregate SQL is needed. Missing roots return 404; roots without children return an empty array.

### Reminder delivery (src/server/services/reminder-service.ts)
The one-minute Cron Trigger calls `processDueReminders`:

1. Requeue occurrences whose claim lock expired (`claimed_until < now`, `attempt_count < 3`).
2. Atomically claim due occurrences (`UPDATE … WHERE status='due'` — the row change count decides the winner).
3. Deliver: insert an in-app notification under an idempotency key `(reminder, occurrence, channel)`; mark the occurrence delivered.
4. Advance recurring reminders by materializing the next occurrence (unique `(reminder_id, occurrence_at)`).

Duplicate Cron invocations therefore deliver each reminder exactly once. Before-due reminders are recalculated (or dismissed) whenever an issue's due date changes.

### Search (src/server/services/search-service.ts)
Mutations maintain `search_docs` (delete+insert, since FTS5 virtual tables reject UPSERT). User input is split on punctuation and each term is quoted; terms are joined with **spaces (implicit AND)** because D1's FTS5 treats explicit `AND`/`OR` as literal terms. Results come from `bm25` ranking with `snippet()` highlighting; type/status/label filters apply post-match via joins. `search_knowledge` reorders results to surface `wiki`, `decision`, `finding`, `incident`, and `learning` types first. `rebuildSearchIndex` is an idempotent full rebuild for recovery.

### Attachments (src/server/services/attachment-service.ts)
Uploads (multipart for the browser, base64 for MCP with a 5 MB cap) are checksummed (SHA-256); the R2 key is `blobs/<checksum>`, so identical content is stored once. Content endpoints enforce `Content-Disposition: inline` only for preview-safe types (images, PDF) and support byte ranges. Deletion is soft; the daily GC removes blobs whose key has no active attachment rows and whose rows are past a 24 h grace period.

### MCP (src/mcp/)
`/mcp` implements Streamable HTTP with JSON-RPC 2.0: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call` (single-message and batch), plus `Mcp-Session-Id` headers and SSE when the client asks exclusively for `text/event-stream`. Session state (initialized flag, client info, TTL) lives in the `McpSession` Durable Object, which also executes tools against the shared services with the DO's bindings. The Worker re-validates the token (hash lookup, revocation, expiry) on **every** HTTP request before routing to the DO. Each tool declares a PRD scope enforced per invocation; insufficient scope yields JSON-RPC error `-32003`.

## Client UI (src/client/)

- **shadcn/ui on Tailwind CSS v4.** Components in `src/client/components/ui/` (generated by the shadcn CLI, `components.json` at the repo root) plus hand-written composition in `src/client/components/` and `src/client/pages/`. Tailwind enters through the `@tailwindcss/vite` plugin and `@import "tailwindcss"` in `src/client/styles.css`; the `@/` alias (`src`) is configured in `vite.config.ts` and `tsconfig.json`. The `@radix-ui`-based primitives assume React 19's ref-as-prop; on React 18 the components composed with `asChild` (`Button`, the router `Link`) forward refs explicitly, which Radix popper positioning depends on.
- **Theme tokens, not literal colors.** `src/client/styles.css` defines a full light (`:root`) and dark (`.dark`) token set (`--background`, `--primary`, `--border`, …), semantic status tokens (`--success`, `--warning`, `--danger`), and an issue-type palette (`--type-wiki`, `--type-epic`, …), mapped into Tailwind's theme (`@theme inline`) so utilities like `bg-card`, `text-danger`, and `border-type-wiki` work in both themes. `color-scheme` is set per theme so native controls (date pickers, scrollbars) match.
- **Theme switching (light / dark / system).** `src/client/theme.tsx` provides a `ThemeProvider`/`useTheme` backed by `localStorage["nodebook-theme"]`; the `.dark` class on `<html>` is the single source of truth. An inline bootstrap script in `index.html` applies the stored (or system-resolved) theme before first paint — no flash of the wrong theme — and system mode follows `prefers-color-scheme` changes live via `matchMedia`. The topbar menu (sun/moon/monitor icons) switches modes; the chosen mode is persisted.
- **Behavioral hooks for e2e.** Migrated components keep the class names the Playwright suite selects on (`.chip`, `.issue-row`, `.sub-issues`, `.sub-issue-row`, `.sub-issues-progress`, `.sub-issue-toggle`, `.sub-issue-icon-open`, `.sub-issue-icon-closed`, `.sub-issues-create`, `.bell`, `.notif-title`, `.attachment-item`, `.attachment-link`, `.reminder`, `.comment`, `.rel-item`, `.label-editor`, `.uploader`, `.tree-link`, `.search-result`, …) and keep native `<select>` elements where the suite drives them with `selectOption` (relationship type, reminder kind).

## Testing strategy

- `test/unit` (Node) — pure logic: recurrence/DST, timezone math, reference parsing (code-block exclusion), JWT verification against locally generated RSA keys, token hashing/scopes, FTS escaping.
- `test/integration` (Workers runtime via `@cloudflare/vitest-pool-workers`) — the full worker under `SELF.fetch` with real D1/R2/DO bindings: auth rejection, concurrent numbering, state transitions, cycle/duplicate prevention, late-resolving backlinks, FTS ranking/filters/rebuild, planning boundaries, reminder idempotency/locks/recalculation, attachment dedupe/ranges/GC, scheduled handlers, and the complete MCP surface including HTTP/MCP audit parity. Migrations are applied per test file from `test/integration/setup.ts`.
- `test/e2e` (Playwright) — a serial acceptance flow against `wrangler dev` with fresh state: create → edit/plan → child + relationship + comment → reminder delivery → attachment → search → recurring completion → MCP mutation + token revocation → wiki tree.

The integration pool requires `nodejs_compat` for its own harness; the application itself never uses it (see `wrangler.jsonc`).
