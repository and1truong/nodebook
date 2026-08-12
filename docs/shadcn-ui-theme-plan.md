# Plan: Adopt shadcn/ui and add dark/light/system theme support

> **Superseded (palette).** This plan's blue/GitHub token values (`--primary: #2f81f7` / `#4da3ff`, `--accent: #ddf4ff`, …) were later replaced by a palette derived from TabTerm's warm parchment/brown/gold theme — see `docs/architecture.md` (Client UI → Theme tokens). The infrastructure described here (shadcn components, Tailwind v4 theming, `ThemeProvider` with light/dark/system, pre-paint bootstrap) is unchanged and in production; only the colour values and the type/semantic palette mapping differ. Treat the hex values below as historical.

## Outcome
When complete, NodeBook's client UI is built on shadcn/ui components (Tailwind CSS v4, CSS-variable theming, `@/` path alias) instead of the hand-rolled `styles.css` sheet, and users can switch between **light**, **dark**, and **system** themes via a topbar control, with localStorage persistence, no flash-of-wrong-theme on load, and live following of OS preference in system mode. All existing quality gates (lint, typecheck, unit, build, integration, e2e, deploy dry-run) stay green.

## Current behavior
- The entire SPA in `src/client/` (21 files: `App.tsx`, `main.tsx`, `router.tsx`, 8 components, 9 pages) is styled exclusively by `src/client/styles.css` (990 lines, ~120 class selectors: `.shell`, `.topbar`, `.sidebar`, `.btn`, `.badge`, `.chip`, `.issue-row`, `.panel`, `.state`, `.markdown`, …), imported once in `src/client/main.tsx`.
- The theme is **dark-only**: colors live in `:root` custom properties (`--bg: #0f1216`, `--accent: #4da3ff`, `--green`, `--red`, `--yellow`, …). There is no light palette, no `prefers-color-scheme` handling, no toggle, no persistence.
- No Tailwind, no `components.json`, no `src/lib/utils.ts`, no `@/*` path alias (`vite.config.ts` and `tsconfig.json` have none).
- `index.html` has no bootstrap script; `#root` renders `<App />` directly.
- Client components use raw HTML elements (buttons, selects, inputs) with utility-free classes.
- The e2e suite (`test/e2e/mvp.spec.ts`) locates elements both by accessible roles/labels **and** structural classes: `.chip`, `.issue-row`, `.bell`, `.notif-title`, `.attachment-item`, `.attachment-link`, `.reminder`, `.comment`, `.rel-item`, `.label-editor`, `.uploader`.
- Unit/integration tests never import client code, so they are unaffected by client-only changes. CI (`.github/workflows/ci.yml`, Node 22) runs `npm run build` then e2e against the built bundle.

## Decisions
- **Full migration** (not foundation-only): "use shadcn ui" is treated as replacing the hand-rolled UI across all pages/panels, not just adding the toolchain. If only the foundation + shell is wanted, Steps 3–4 are trimmed.
- **Tailwind v4 + `@tailwindcss/vite`**: this is what the shadcn CLI targets today for Vite; no PostCSS config needed. `tw-animate-css` for animation utilities.
- **Custom theme provider, not `next-themes`**: next-themes is Next.js-oriented; for this Vite SPA we implement a small `ThemeProvider` (localStorage key `nodebook-theme`, values `light|dark|system`, `.dark` class on `<html>` per shadcn convention) plus an inline script in `index.html` to set the class pre-paint (no FOUC) and a `matchMedia` listener in system mode.
- **Keep e2e class hooks**: migrated components retain the class names the tests select on (listed above); no e2e rewrite required for the migration itself.
- **Status/priority/type colors become semantic theme tokens** (`--success/--warning/--danger`, plus a small type palette) instead of the literal `--green/--red/--yellow`, so both themes render correctly.
- **`@/` alias** added to `vite.config.ts` + `tsconfig.json` (shadcn-generated imports need it). `vitest.config.ts` doesn't merge vite config, but unit tests don't import client code, so no change needed there.
- **`styles.css` filename kept** (`src/client/styles.css`), content replaced with Tailwind + theme variables; `main.tsx` import unchanged.
- **Branch**: work happens on a new branch `feat/shadcn-ui-theming` cut from `feat/nodebook-mvp` (current branch).

## Implementation

1. **Install toolchain and initialize shadcn**
   - Paths: `package.json`, `vite.config.ts`, `tsconfig.json`, new `components.json`, new `src/lib/utils.ts`, `src/client/styles.css`
   - Change: `npm install tailwindcss @tailwindcss/vite tw-animate-css lucide-react`; add `tailwindcss()` plugin to `vite.config.ts` plugins and `resolve.alias { "@": "/src" }`; add `baseUrl`/`paths { "@/*": ["./src/*"] }` to `tsconfig.json`; run `npx shadcn@latest init` (base color: blue to match the current `--accent`; CSS variables: yes). Replace `styles.css` content with `@import "tailwindcss"; @import "tw-animate-css";` + the generated theme token blocks (`:root` light, `.dark`).
   - Verify: `npm run typecheck`, `npm run build`; `npm run dev:web` renders with layout intact (theme not wired yet — apply Step 2 before judging visuals).

2. **Theme system (dark / light / system)**
   - Paths: `index.html`, new `src/client/theme.tsx` (provider + `useTheme` hook), `src/client/main.tsx`, `src/client/components/AppShell.tsx`, `src/client/components/ui/` (after `npx shadcn@latest add dropdown-menu`)
   - Change:
     - `index.html`: inline script in `<head>` — read `localStorage.nodebook-theme`; resolve `system` via `matchMedia("(prefers-color-scheme: dark)")`; `document.documentElement.classList.toggle("dark", …)`; also set `color-scheme` inline style from the resolved theme. Runs before the bundle loads.
     - `theme.tsx`: context with `theme: "light"|"dark"|"system"`, `setTheme` (persists to localStorage, applies/removes `.dark` on `document.documentElement`), and in system mode a `matchMedia` change listener that flips the class live. Initialize from `document.documentElement` so provider and bootstrap script never disagree.
     - `styles.css`: full light token set (`--background`, `--foreground`, `--card`, `--primary` = `#2f81f7`/`#4da3ff` accent mapping, `--border`, `--muted`, `--destructive`) + `.dark` overrides; add semantic tokens `--success`, `--warning`, `--danger` in both themes; `color-scheme: light`/`dark` per theme.
     - `AppShell.tsx`: add theme control in `.topbar-right` — `DropdownMenu` trigger (Sun/Moon/Monitor icons from `lucide-react`) with three items (Light / Dark / System), current selection checked.
   - Verify: manual — toggle all three modes, reload (persistence + no flash), change OS appearance in system mode; `npm run typecheck`.

3. **Migrate shared primitives and shell**
   - Paths: `src/client/components/ui.tsx`, `src/client/components/AppShell.tsx`, `src/client/components/NotificationInbox.tsx`; add shadcn components: `npx shadcn@latest add button input textarea select label badge card separator skeleton tooltip`
   - Change: rewrite `ui.tsx` on shadcn primitives, keeping exports (`Loading` → Skeleton, `ErrorState`/`EmptyState` → Card + Button, `TypeBadge`/`StatusBadge`/`LabelChip` → Badge with variant/token classes, `IssueRow`/`PlanningList`/`PageHeader` → shadcn + Tailwind). Preserve e2e hooks: `.issue-row`, `.issue-number`, `.issue-title`, `.dot`, `.chip`, `.badge`, `.date-label`, `.overdue-label`, `.state`. Rebuild `AppShell` layout with Tailwind grid (`grid-cols-[190px_1fr]`, sticky topbar), `Input`/`Select`/`Button` in quick-create (keep `#quick-create-input` id + `n` hotkey), `DropdownMenu`-or-`Popover` notification bell (keep `.bell` hook and `.notif-title` in `NotificationInbox`), `Badge`-style brand; keep `.nav-item.active` semantics via `data-[active=true]:` or `aria-current` + Tailwind. Drop legacy `.shell/.topbar/.sidebar/.content` rules from `styles.css`.
   - Verify: `npm run typecheck`, `npm run build`, `npx playwright test test/e2e/mvp.spec.ts --grep "create an issue"` (first test exercises quick-create, edit, chips, issue-row).

4. **Migrate pages and panels**
   - Paths: `src/client/components/` — `HierarchyTree.tsx`, `BacklinksPanel.tsx`, `RelationshipsPanel.tsx`, `HistoryPanel.tsx`, `AttachmentUploader.tsx`, `ReminderEditor.tsx`, `SearchResults.tsx`, `IssueEditor.tsx`, `Markdown.tsx`; `src/client/pages/` — `InboxPage.tsx`, `TodayPage.tsx`, `UpcomingPage.tsx`, `IssuesPage.tsx`, `IssueDetailPage.tsx`, `WikiPage.tsx`, `SearchPage.tsx`, `TokenSettingsPage.tsx`, `NotFoundPage.tsx`
   - Change: replace raw elements with shadcn components — forms (`IssueEditor`, `ReminderEditor`, `TokenSettingsPage`, `SearchPage`, quick-create) → `Input`/`Textarea`/`Select`/`Label` + `Button` variants (default/outline/ghost/destructive, sm/default/icon); panels → `Card`/`CardHeader`/`CardTitle`/`CardContent`; lists → `Badge` + Tailwind list rows; `.markdown` styling (headings, code, blockquote, tables) kept as a compact hand-written block in `styles.css` using theme tokens (deliberately not `@tailwindcss/typography` — avoids a plugin and a prose rewrite). Keep every e2e hook: `.label-editor`, `.rel-item`, `.comment`, `.reminder`, `.attachment-item`, `.attachment-link`, `.uploader`, `.bell`, `.notif-title`, `.chip`, `.issue-row`.
   - Verify: `npm run typecheck`, `npm run build`, full `npm run test:e2e`.

5. **Delete legacy CSS and polish light theme**
   - Paths: `src/client/styles.css`
   - Change: remove all remaining `.btn`, `.badge`, `.panel`, `.topbar`, … legacy rules; keep only Tailwind imports, theme variables (incl. semantic status tokens and type palette), the `.markdown` block, and small base rules (body font, link colors via `--primary`). Light-theme contrast pass on status dots, priority badges, type badges, markdown code blocks.
   - Verify: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:integration`, `npm run test:e2e`.

6. **Theme e2e coverage and docs**
   - Paths: new `test/e2e/theme.spec.ts`, `README.md` (and `docs/architecture.md` client section if it describes the UI layer)
   - Change: theme spec — (a) `emulateMedia({ colorScheme: "dark" })` + fresh context → `html.dark` present (system default); (b) click theme menu → Light → `html.dark` absent and `localStorage["nodebook-theme"] === "light"`; (c) reload → still light (persistence); (d) switch to System → class follows `page.emulateMedia` change. Add a "Theme" bullet to README quick-start/features.
   - Verify: `npm run test:e2e` (both specs), `npm run lint`.

## Verification
- `npm run lint && npm run typecheck && npm test` — static and unit gates after each step.
- `npm run build` — proves Tailwind/shadcn pipeline compiles (vite alias + plugin).
- `npm run test:e2e` — existing MVP spec proves the migration preserved behavior and selectors; new `theme.spec.ts` proves light/dark/system behavior end to end.
- Manual: theme toggle in all three modes; reload without FOUC; OS dark-mode flip while in System; check status/priority/type badges legible in light mode; `npm run dev:web` hot-reload sanity check.

## Risks and rollout
- **shadcn CLI network dependency**: `init`/`add` fetch from the registry; generated files (`components.json`, `src/lib/utils.ts`, `ui/*`) are committed, so CI is unaffected afterward. If the registry is unreachable, hand-write the small files (`utils.ts`, `button`, `input`, `select`, …) — the plan's file layout matches regardless.
- **e2e selector drift** during migration: mitigated by the explicit hook-class list in Steps 3–4; run e2e after Step 3 and Step 4 to catch drift early.
- **Theme flash on load** if the bootstrap script is omitted: Step 2 makes the inline script a first-class deliverable, verified manually and by the persistence test.
- **React 18 + Tailwind v4**: supported; no upgrade needed. CI runs Node 22 (shadcn CLI requires ≥20) — fine.
- **Rollback**: pure client change; revert commits touching `src/client/` and `vite.config.ts`/`tsconfig.json`/`package.json`. No data, migration, or server changes.
- Server, MCP, D1, R2, and Worker code are untouched; `wrangler deploy --dry-run` in CI confirms packaging unaffected.

## Open questions
- None blocking. Assumption to confirm: **full migration** of all client UI (not foundation-only). If a specific page/component should stay hand-rolled, name it and it gets carved out of Steps 3–4.
