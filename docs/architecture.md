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
| `/mcp` | `Authorization: Bearer nbk_…` (PAT, SHA-256 lookup per request) **or** `nbo_…` OAuth access token (resolved to its owner-approved grant) | Streamable HTTP MCP → session Durable Object |
| `/.well-known/oauth-authorization-server` | — (public) | OAuth authorization-server metadata (RFC 8414) |
| `/.well-known/oauth-protected-resource/mcp` | — (public) | OAuth protected-resource metadata for `/mcp` (RFC 9728) |
| `/oauth/register` | — (public; dynamic client registration, RFC 7591) | Register a public PKCE client with an exact HTTPS redirect-URI allowlist |
| `/oauth/authorize` | Cloudflare Access JWT, email must equal `OWNER_EMAIL` | Owner consent page; issues one-time authorization codes (PKCE S256) |
| `/oauth/token` | — (public; client_id + PKCE/refresh token prove possession) | Authorization-code and rotating refresh-token exchanges |
| everything else | — | `ASSETS` binding (SPA with history fallback) |
| `scheduled()` | — | Cron: `* * * * *` reminders, `0 3 * * *` attachment GC |

Auth is fail-closed: with neither `ACCESS_TEAM`/`ACCESS_AUD` nor `AUTH_DEV_EMAIL` configured, all API requests are rejected. `AUTH_DEV_EMAIL` must never be set in production. `/mcp` rejects requests without a valid bearer credential with a `401` + `WWW-Authenticate: Bearer resource_metadata="…"` challenge so OAuth-capable clients can discover the authorization server.

## OAuth authorization server

NodeBook is its own OAuth 2.1 authorization server (`src/server/services/oauth-service.ts`, `src/server/routes/oauth.ts`), so ChatGPT-style connectors can authenticate without a manually pasted PAT:

- **Clients** are dynamically registered (`POST /oauth/register`) as public clients; only exact HTTPS redirect-URI matches are accepted (loopback `http://localhost` allowed for local development). No client secrets exist.
- **Consent** (`/oauth/authorize`) reuses the Cloudflare Access owner check and renders a server-side page listing the requesting client, resource (`<OAUTH_ISSUER>/mcp`), and scopes. The owner explicitly approves or denies; approval records an `oauth_grant.approve` audit event.
- **Codes and tokens** are one-time/opaque high-entropy strings; only SHA-256 hashes are stored. Authorization codes expire after 10 minutes and are consumed atomically; access tokens live 10 minutes; refresh tokens live 180 days and rotate on every use. Scopes can never expand beyond the owner-approved grant.
- **Grants** (`oauth_grants`) are stable owner-approved connections: refresh rotation and repeated approvals keep the same grant id, so audit attribution never changes with the credential. Revoking a grant in Settings invalidates every associated access and refresh token immediately (`oauth_grant.revoke` audit event).
- All discovery, registration, token, and `/mcp` endpoints are reachable without a Cloudflare Access header; only `/oauth/authorize` (and the web UI/API) sit behind Access.

The OAuth `issuer` is the configured `OAUTH_ISSUER` variable (production) or the request origin (development), so metadata and resource validation never depend on an untrusted request host in production.

## Data model (D1 migrations)

- `0001_core.sql` — `issues` (global sequential `number` allocated via a single `UPDATE meta … RETURNING`), `labels`, `issue_labels`, `comments`, `relationships` (directional, unique per source/target/type), `issue_references` (`#123` with nullable `target_issue_id` for late resolution; the table is named `issue_references` because `references` is a SQLite keyword), `audit_events`, `mcp_tokens` (hash + prefix + scopes).
- `0002_graph.sql` — `issue_stats` view (child/backlink counts) powering wiki navigation.
- `0003_search.sql` — `search_docs` FTS5 table (`porter unicode61`). `labels` and `attachment_meta` are indexed columns so they participate in MATCH; entity/issue ids are `UNINDEXED`.
- `0004_planning.sql` — `occurrences` (recurring-task completions, unique per issue+instant).
- `0005_reminders.sql` — `reminders`, `reminder_occurrences` (materialized deliveries with expiring claim locks), `notifications`, `notification_deliveries` (idempotency keys).
- `0006_attachments.sql` — `attachments` metadata (soft-delete + R2 key = blob checksum).
- `0008_issue_version.sql` — monotonic `issues.version` revision for optimistic locking across browser and MCP edits.
- `0009_oauth.sql` — `oauth_clients` (public clients + exact redirect-URI allowlists), `oauth_grants` (stable owner-approved connections, scopes, usage, revocation), `oauth_codes` (one-time hashed codes with PKCE challenges, resource, expiry, consumed state), `oauth_tokens` (hashed access/refresh tokens, kind, grant ownership, expiry, rotation/revocation state). Grant revocation cascades to every token via `revokeTokensForGrant`.

## Key algorithms

### Issue numbering
`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'issue_seq' RETURNING value` — a single atomic statement, so concurrent creates can never observe the same number (covered by an integration test).

### Recurrence (src/shared/recurrence.ts)
RFC 5545 subset: `FREQ=DAILY|WEEKLY|MONTHLY`, `INTERVAL`, `BYDAY` (daily/weekly), `COUNT`, `UNTIL`. All math is civil-time in the issue's IANA timezone via `Intl.DateTimeFormat`:

- `instantFromCivil` resolves DST gaps/overlaps deterministically (gap times land on the post-transition instant; overlaps pick the first occurrence).
- Weekly rules advance from the anchor week; monthly rules preserve the anchor day-of-month, clamped to month length.
- `COUNT` is enforced across repeated completions: the service counts recorded occurrences and passes the initial ordinal into `nextOccurrence`.

Completing a recurring task records an occurrence and advances `start_date`/`due_date`/`scheduled_date` from the **last planned occurrence** (not "now"), so early or late completion still rolls the series by exactly one interval. Non-recurring tasks close normally.

### Sub-issues (GitHub-style lazy hierarchy)
`GET /api/graph/:ref/sub-issues` returns **one hierarchy level per request**: the direct children of the ref as flat `SubIssueSummaryDto`s (id, number, title, status, parent_id, child_count, closed_child_count) ordered by number. Each row's `child_count`/`closed_child_count` describe that issue's own direct children, so expand controls and progress badges render without fetching descendants — completion progress is **closed direct children / total direct children** per node, matching GitHub's nested progress badges. The issue page places this hierarchy in the default Sub-issues tab of its content tab set. The client loads the root level on mount, starts every branch collapsed, and fetches a branch's children on first expansion (`GET /api/graph/:ref/sub-issues` for that issue); successfully loaded branches are cached for the life of the page, failures stay local with a retry, and navigating to another issue resets the cache. Missing roots return 404; leaves return an empty array. The legacy `GET /api/graph/:ref/children` (flat, full `IssueDto`s) is retained for compatibility.

**Attaching existing issues.** The panel's action area is a GitHub-style split control: the primary segment reveals the inline create form, while a chevron (`Sub-issue actions` dropdown) offers both **Create sub-issue** and **Add existing issue**. The existing-issue picker (`ExistingIssuePicker.tsx`) queries `GET /api/graph/:ref/sub-issue-candidates`, which excludes the current root and **every descendant server-side** via a recursive CTE — so unexpanded branches can never leak into the picker regardless of what the panel has lazily loaded. The endpoint preserves the picker's semantics: recent issues when the query is empty, debounced title/body `LIKE` search, and bare numbers / `#123` exact lookups (merged and deduped with the LIKE results). Linking runs through the existing `POST /api/graph/:ref/parent` route — no new endpoint or migration. It runs under the server's `setParent` validation (missing parent → 404, self-parent → 400, cycle → 409) and records the same `issue.set_parent` audit event with before/after `parent_id` payloads. Because the schema permits one parent per issue, attaching an issue that already has a parent **moves** it (its status, content, labels, and descendants are untouched — only `parent_id` changes); candidate rows show the existing parent badge and a note explains the move before the user confirms. The picker debounces input, discards stale responses, and stays open on failure so the server message remains visible. On success the panel reloads the root's first level so rows and progress reflect the authoritative hierarchy.

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
Uploads (multipart for the browser, base64 for MCP with a 5 MB cap) are checksummed (SHA-256); the R2 key is `blobs/<checksum>`, so identical content is stored once. Content endpoints enforce `Content-Disposition: inline` only for preview-safe types (images, PDF) and support byte ranges. Deletion is soft; the daily GC removes blobs whose key has no active attachment rows and whose rows are past a 24 h grace period. The GC/R2 race is closed by a tombstone handshake: the GC tombstones a key before deleting, re-checks the tombstone and active-row count right before the delete, and concurrent uploads of identical content restore the blob and clear the tombstone, verifying the blob afterwards so a delete already in flight can never land after the repair.

### MCP (src/mcp/)
`/mcp` implements Streamable HTTP with JSON-RPC 2.0: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call` (single-message and batch), plus `Mcp-Session-Id` headers and SSE when the client asks exclusively for `text/event-stream`. Session state (initialized flag, client info, TTL) lives in the `McpSession` Durable Object, which also executes tools against the shared services with the DO's bindings. The Worker re-validates the token (hash lookup, revocation, expiry) on **every** HTTP request before routing to the DO. Each tool declares a PRD scope enforced per invocation; insufficient scope yields JSON-RPC error `-32003`.

## Client UI (src/client/)

- **shadcn/ui on Tailwind CSS v4.** Components in `src/client/components/ui/` (generated by the shadcn CLI, `components.json` at the repo root) plus hand-written composition in `src/client/components/` and `src/client/pages/`. Tailwind enters through the `@tailwindcss/vite` plugin and `@import "tailwindcss"` in `src/client/styles.css`; the `@/` alias (`src`) is configured in `vite.config.ts` and `tsconfig.json`. The `@radix-ui`-based primitives assume React 19's ref-as-prop; on React 18 the components composed with `asChild` (`Button`, the router `Link`) forward refs explicitly, which Radix popper positioning depends on.
- **Theme tokens, not literal colors.** `src/client/styles.css` defines a full light (`:root`) and dark (`.dark`) token set (`--background`, `--primary`, `--border`, …), semantic status tokens (`--success`, `--warning`, `--danger`), and an issue-type palette (`--type-wiki`, `--type-epic`, …), mapped into Tailwind's theme (`@theme inline`) so utilities like `bg-card`, `text-danger`, and `border-type-wiki` work in both themes. `color-scheme` is set per theme so native controls (date pickers, scrollbars) match. The palette is **derived from TabTerm's client theme** (read-only reference at `~/dirs/tabterm/src/client/index.css`), kept warm and parchment-toned in both modes: light `#f5f0e8` background / `#fffcf6` panels / `#7a5c00` gold; dark `#1a1200` background / `#251a00` panels / `#ffd000` gold. Light-mode text-facing gold/red tokens are darkened one step from TabTerm's values (`#7a5c00` gold, `#b91c1c` danger) so foreground text stays ≥ 4.5:1 (WCAG AA) on the parchment ground. A `--recess` token (light `#ece5d8` / dark `#120c00`) backs recessed surfaces such as Markdown code blocks. Issue types derive from the same palette: gold for knowledge types, purple for epics, orange for bugs, red for incidents, muted for tasks; label chips use TabTerm's brand colours. NodeBook's light/dark/system switching, persistence key, and pre-paint bootstrap are unchanged — only the palette values were replaced.
- **Theme switching (light / dark / system).** `src/client/theme.tsx` provides a `ThemeProvider`/`useTheme` backed by `localStorage["nodebook-theme"]`; the `.dark` class on `<html>` is the single source of truth. An inline bootstrap script in `index.html` applies the stored (or system-resolved) theme before first paint — no flash of the wrong theme — and system mode follows `prefers-color-scheme` changes live via `matchMedia`. The topbar menu (sun/moon/monitor icons) switches modes; the chosen mode is persisted.
- **Behavioral hooks for e2e.** Migrated components keep the class names the Playwright suite selects on (`.chip`, `.issue-row`, `.sub-issues`, `.sub-issue-row`, `.sub-issues-progress`, `.sub-issue-toggle`, `.sub-issue-icon-open`, `.sub-issue-icon-closed`, `.sub-issues-create`, `.bell`, `.notif-title`, `.attachment-item`, `.attachment-link`, `.reminder`, `.comment`, `.rel-item`, `.label-editor`, `.uploader`, `.tree-link`, `.search-result`, …) and keep native `<select>` elements where the suite drives them with `selectOption` (relationship type, reminder kind). Newer hooks: `.sub-issues-action`, `.sub-issues-action-menu`, `.sub-issues-link-form`, `.existing-issue-result` for the split-button menu and existing-issue picker; `.sub-issue-branch-loading`, `.sub-issue-branch-error` for lazy branch fetch states.
- **Issue detail layout (view mode).** `IssueDetailPage` renders a GitHub-style two-column layout for `/issues/:ref`: a full-width header (`issue-head`) keeps the number, title, status badge, and Complete/Close/Reopen/Edit actions; below it an `issue-layout` grid (`minmax(0, 1fr) 280px`, stacking below `min-width: 1200px`) holds the conversation column (`issue-main`: Markdown body, `IssueContentTabs`, Comments, History) and the `IssueSidebar` (`<aside aria-label="Issue details">`). `IssueContentTabs` uses Radix tab semantics for Sub-issues, Backlinks, Attachments, and Reminders, mounts all four panels so their status is known, and shows a visible badge for every ready tab including zero; loading and failed requests use distinct indicators instead of appearing empty. The Sub-issues badge shows closed/total completion when populated. The sidebar renders compact border-separated sections for properties (type, priority, labels, parent link, start/due/scheduled dates with overdue styling, recurrence rule, closed time — `None` where unset) and relationships. `ReminderEditor` and `RelationshipsPanel` take an `embedded` prop that suppresses their outer card/heading; the reminder tab uses its wide embedded layout while relationships stack full-width controls for the narrow rail. Behavioral selectors (`.uploader`, `.attachment-item`, `.reminder-form`, `.reminder`, `.rel-item`, backlink links) remain available in their new locations. Edit/create forms stay single-column. AppShell widens its content limit to `1280px` only on detail routes (create excluded); lists and settings keep `980px`. Wiki routes use the separate focused reading view in `WikiPage`.

## Testing strategy

- `test/unit` (Node) — pure logic: recurrence/DST, timezone math, reference parsing (code-block exclusion), JWT verification against locally generated RSA keys, token hashing/scopes, FTS escaping.
- `test/integration` (Workers runtime via `@cloudflare/vitest-pool-workers`) — the full worker under `SELF.fetch` with real D1/R2/DO bindings: auth rejection, concurrent numbering, state transitions, cycle/duplicate prevention, late-resolving backlinks, FTS ranking/filters/rebuild, planning boundaries, reminder idempotency/locks/recalculation, attachment dedupe/ranges/GC, scheduled handlers, and the complete MCP surface including HTTP/MCP audit parity. Migrations are applied per test file from `test/integration/setup.ts`.
- `test/e2e` (Playwright) — a serial acceptance flow against `wrangler dev` with fresh state: create → edit/plan → child + relationship + comment → reminder delivery → attachment → search → recurring completion → MCP mutation + token revocation → wiki tree.

The integration pool requires `nodejs_compat` for its own harness; the application itself never uses it (see `wrangler.jsonc`).
