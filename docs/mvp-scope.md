# NodeBook MVP Scope

The MVP covers PRD features M1–M11 for a single-owner workspace. This document records the explicit limits and traces each PRD success criterion to its automated or manual check.

## In scope (M1–M11)

| # | Feature | Implementation | Verification |
| --- | --- | --- | --- |
| M1 | Issues, comments, labels, Markdown | `issue-service`, `comment-service`, issue/comment routes, Markdown renderer (sanitized via DOMPurify, `#123` and `attachment://` linkification) | `test/integration/issues.test.ts`, `test/unit/refs.test.ts`, e2e create/edit/comment |
| M2 | Hierarchy, typed relationships, references | `graph-service`, `issue_references` with late resolution | `test/integration/graph.test.ts` (cycles, self-parent, duplicates, inverse dupes, late-resolving backlinks, code-block exclusion, direct-level sub-issue responses with counts, server-side link-candidate exclusion, reparent-with-descendants + audit); e2e existing-issue linking (link, exclude, reparent, cycle guard) |
| M3 | Wiki projection | wiki tree, breadcrumbs, backlinks, related panels, `issue_stats` view | `test/integration/graph.test.ts` (wiki), e2e wiki tree |
| M4 | Full-text search | FTS5 `search_docs`, incremental index, idempotent rebuild, filters, `search_knowledge` ordering | `test/integration/search.test.ts` (ranking, filters, punctuation/empty boundaries, comment/label indexing, rebuild consistency) |
| M5 | Planning views | Inbox/Today/Calendar/Overdue in owner timezone; `GET /api/planning/calendar` (bounded end-exclusive civil range, timezone-derived instant bounds, dual due/scheduled entries) powers the browser Calendar workspace | `test/integration/planning.test.ts` (boundaries, ordering, timezone, DST, dual entries, invalid ranges), `test/unit/calendar.test.ts` (grids, navigation, clamping), e2e `calendar.spec.ts` (views, redirect, failures, mobile) |
| M6 | Recurring tasks | RFC 5545 rules (daily/weekly/monthly + interval + BYDAY/COUNT/UNTIL), occurrence recording, atomic date advancement | `test/unit/recurrence.test.ts` (DST, month clamps, count/until), `test/integration/planning.test.ts` |
| M7 | Reminders | absolute / before-due / recurring, claim locks, idempotent delivery, snooze/dismiss, due-date recalculation | `test/integration/reminders.test.ts` (duplicate Cron, lock expiry, recalc, recurrence/DST, snooze), `test/integration/scheduled.test.ts` |
| M8 | Notifications | in-app inbox, unread counts, read state, 30 s polling while open | `test/integration/reminders.test.ts`, e2e inbox flow |
| M9 | Private attachments | R2 blobs, checksum dedupe, range/download/preview, soft delete + GC | `test/integration/attachments.test.ts` (ownership, dedupe, size/type, ranges, GC, shared-blob safety) |
| M10 | MCP server | Streamable HTTP, 18 scoped tools over shared services, DO session state, per-request token revalidation | `test/integration/mcp.test.ts`, `test/integration/auth.test.ts` (protocol, one test per tool family, scopes, revocation, size limit, audit parity) |
| M11 | Audit history | immutable before/after payloads, actor attribution (human/mcp/system) | `test/integration/auth.test.ts`, `test/integration/issues.test.ts`, e2e visible history |

## Out of scope (explicit MVP limits)

- **Multi-user collaboration** — one private workspace, one human owner. Access checks enforce a single `OWNER_EMAIL`; there are no teams, roles, assignees, or per-issue sharing. Actor/workspace boundaries remain explicit in service APIs so multi-owner can be added later.
- **Email/push notifications** — delivery is in-app only. The delivery layer is channel-shaped (idempotency key is `(reminder, occurrence, channel)`), so email/push are additive.
- **Second-level reminder precision** — the one-minute Cron Trigger provides minute-level delivery; the documented SLA is one Cron interval plus platform scheduling delay.
- **Semantic search / OCR** — FTS5 keyword search only; attachments are indexed by filename/type metadata, not content.
- **Offline support** — the SPA requires connectivity; no service worker.
- **Recurrence breadth** — UI schedules daily/weekly/monthly only (rules are stored as full RFC 5545 text, so richer rules can be added); monthly `BYDAY`, yearly rules, and `RDATE`/`EXDATE` are unsupported and rejected by validation.
- **MCP transport** — Streamable HTTP only (no WebSocket/stdio transport); SSE is offered when a client requests it exclusively.
- **Attachments** — 25 MB browser / 5 MB MCP caps; no client-side encryption, no virus scanning, no multi-file selection in the picker (drag/drop of one file at a time).

## Reviewer-driven decisions and documented behaviors

- **Linking an existing issue as a sub-issue is a move, not a copy.** The sub-issues panel exposes a GitHub-style split action (create form on the primary segment; dropdown with **Create sub-issue** and **Add existing issue**). The existing-issue picker queries `GET /api/graph/:ref/sub-issue-candidates` and links through `POST /api/graph/:ref/parent` — no new schema change or migration. The candidates endpoint excludes the current root and all descendants **server-side** (recursive CTE), so unexpanded lazy branches never leak into the picker. Because the schema permits one parent per issue, an issue already under another parent is moved: its status, content, labels, and descendants are preserved, only `parent_id` changes, and the server's `setParent` validation (404/400/409) plus `issue.set_parent` audit record apply unchanged. The picker shows recent issues when empty, debounces search, treats `123`/`#123` as exact lookups (merged server-side with LIKE results), and keeps failures visible without closing the picker; the panel's first level is reloaded after each successful link.

- **Inbox includes child issues by design.** The PRD defines Inbox as "open items without start, due, or scheduled values" — a capture list, not a root-only view. Tree position is not a filter; subtasks of projects appear until they are planned. If a roots-only Inbox is ever desired it is a one-line filter change in `planning-service.getInbox`.
- **Dateless recurring tasks roll forward into planning.** Completing a recurring task with no start/due/scheduled dates sets `scheduled_date` to the next occurrence, so the task surfaces in Today/Calendar on its cycle day instead of staying in Inbox forever. `start_date` advances to the next occurrence too (never the completion instant), so `start > due` cannot render even under very late completion.
- **The Calendar workspace replaces the Upcoming page without breaking API/MCP consumers.** `/upcoming` redirects (replace-style, no duplicate history entry) to `/calendar`, which renders open issues' due dates and scheduled instants in navigable day/week/month views. Entries use viewer-local dates: due dates are all-day, scheduled instants are converted to the viewer's timezone, and an issue with both values produces two entries. `start_date` stays excluded, matching Upcoming semantics. The range API is bounded and end-exclusive (`start`/`end` civil dates, `tz` IANA; instant bounds derived via `instantFromCivil` so DST transitions cannot misplace an entry), while `getUpcoming`, `GET /api/planning/upcoming`, and MCP `get_upcoming` remain unchanged.
- **Attachment GC is tombstone-based.** `gc_tombstones` (migration 0007) is written before a blob delete; a concurrent upload of identical content that lands its row around the deletion detects the tombstone, re-puts the blob, and clears it. The documented claim — a referenced blob is never permanently lost to D1/R2 partial ordering — holds; tombstone rows are cleaned up after 2× the grace period.
- **Known performance characteristics (MVP-acceptable, revisit before multi-user):** the wiki tree endpoint (`buildWikiNode`) and `getChildrenDtos` issue one `getIssueById` per child, and `searchIssues` runs one label query per result row. All are bounded by workspace size and were consciously traded against batch-query complexity; the wiki tree will degrade first as the graph grows. The sub-issue panel loads lazily, GitHub-style: one indexed direct-children query per request (`idx_issues_parent`), with the root level fetched on page load and each branch fetched only on first expansion and cached afterwards — so deep hierarchies cost one request per opened branch (payload proportional to one level, never the whole subtree).
- **CI is enforced.** `.github/workflows/ci.yml` runs `npm ci` (frozen lockfile), lint, typecheck, unit tests, build, workerd integration tests, Playwright E2E, and `wrangler deploy --dry-run` on every PR and push to `main`. The review-time "no CI" gap is closed.

## PRD success criteria → checks

| Criterion | Check |
| --- | --- |
| Issue CRUD + state transitions work through web and MCP with identical rules | `test/integration/issues.test.ts`, `test/integration/mcp.test.ts` (create/update/close/complete), audit parity assertions |
| Numbers are stable, sequential, and unique under concurrency | `test/integration/issues.test.ts` (12 concurrent creates → 12 unique numbers) |
| Graph invariants hold (no cycles/self-parents/duplicate links) | `test/integration/graph.test.ts` |
| References resolve even when created before their target | `test/integration/graph.test.ts` (late resolution, comment refs) |
| Search returns ranked, filtered, safe results; index stays consistent | `test/integration/search.test.ts` incl. rebuild |
| Recurring tasks never close; non-recurring tasks close; COUNT terminates | `test/integration/planning.test.ts` |
| Reminder delivery is exactly-once under duplicate Cron invocations and survives crashed attempts | `test/integration/reminders.test.ts` |
| Attachments are private, deduplicated, range-servable, and GC-safe | `test/integration/attachments.test.ts` |
| MCP scopes and revocation are enforced per request | `test/integration/auth.test.ts`, `test/integration/mcp.test.ts` |
| Web/API is protected by Cloudflare Access and owner-only | `src/server/auth/access-auth.ts` + `test/unit/access-auth.test.ts` (JWT verification), `test/integration/auth.test.ts` |
| Browser acceptance flow spans creation → linking → planning → reminder delivery → attachment → search → MCP mutation → audit history | `test/e2e/mvp.spec.ts` (8 serial tests + lazy nested sub-issue tree scenario with branch failure/retry and cache reuse + existing-issue linking/reparent/cycle-guard scenario) |

## Manual staging smoke test (post-deploy)

1. Access-protected hostname: anonymous curl to `/api/me` → 401; through Access → owner email.
2. Private R2: attachment content URL without a session → 401.
3. Real Cron: create a due reminder, observe the notification appear within one minute.
4. Scoped MCP: initialize with a read-only token, `tools/call create_issue` → `-32003`; with a write token → 201-equivalent; revoke → 401 on the next request.
