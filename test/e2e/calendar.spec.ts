/**
 * Calendar workspace (browser): routing, configurable default view, views,
 * drag-and-drop rescheduling (pointer + keyboard), failure rollback, the
 * day-view time-slot dragging and "Move date…" shortcuts/picker, accessibility selectors, and
 * narrow-screen rendering.
 *
 * The context runs in UTC (timezoneId) so fixture dates computed in the test
 * process match the browser's "today" and the worker's tz parameter exactly.
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

test.use({ timezoneId: "UTC" });

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
}

function startOfWeek(date: string): string {
  return addDays(date, -weekday(date));
}

/** The Monday on or before `date`. */
function startOfWeekMonday(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** A date in the current Sunday-first week that is not `today`. */
function weekTarget(today: string): string {
  return addDays(today, weekday(today) === 6 ? -1 : 1);
}

/** Another date in the current week, distinct from both given dates. */
function otherWeekDay(today: string, target: string): string {
  const start = startOfWeek(today);
  const end = addDays(start, 6);
  for (const offset of [-1, 1, -2, 2, -3, 3]) {
    const candidate = addDays(today, offset);
    if (candidate >= start && candidate <= end && candidate !== target) return candidate;
  }
  throw new Error("no other day in the week");
}

/** First cell of the six-week Sunday-first month grid containing `date`. */
function monthGridStart(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  return startOfWeek(first);
}

function firstOfNextMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const ny = m === 12 ? y! + 1 : y!;
  const nm = m === 12 ? 1 : m! + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

async function apiJson(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const res = await request.fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status(), json };
}

async function createIssue(request: APIRequestContext, input: Record<string, unknown>) {
  const res = await apiJson(request, "POST", "/api/issues", input);
  expect(res.status).toBe(201);
  return res.json as unknown as { id: string; number: number; title: string };
}

async function getIssue(request: APIRequestContext, number: number) {
  const res = await apiJson(request, "GET", `/api/issues/${number}`);
  expect(res.status).toBe(200);
  return res.json as unknown as { due_date: string | null; scheduled_date: string | null };
}

/** Pointer-drag `from` onto `to`; `onTarget` runs mid-drag for styling checks. */
async function pointerDrag(page: Page, from: Locator, to: Locator, onTarget?: () => Promise<void>) {
  const src = await from.boundingBox();
  const dst = await to.boundingBox();
  expect(src).not.toBeNull();
  expect(dst).not.toBeNull();
  await page.mouse.move(src!.x + src!.width / 2, src!.y + src!.height / 2);
  await page.mouse.down();
  await page.mouse.move(dst!.x + dst!.width / 2, dst!.y + dst!.height / 2, { steps: 12 });
  if (onTarget) await onTarget();
  await page.mouse.up();
  // dnd-kit keeps its post-drag click guard for 50 ms so releasing an entry
  // cannot accidentally follow the issue link.
  await page.waitForTimeout(75);
}

test.describe.serial("Calendar workspace", () => {
  test("redirects /upcoming to /calendar and marks the Calendar nav active", async ({ page }) => {
    await page.goto("/upcoming");
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Upcoming" })).toHaveCount(0);

    await page.goto("/calendar");
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
  });

  test("opens in the configured Week view by default and fetches the week range", async ({ page, request }) => {
    const today = todayUtc();
    // A fixture keeps the week grid from collapsing into the empty state;
    // placed off today so later month-cell assertions stay uncrowded.
    await createIssue(request, { title: "Default week fixture", due_date: weekTarget(today) });
    const calendarRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/planning/calendar")) calendarRequests.push(req.url());
    });

    await page.goto("/calendar");

    const week = page.locator(".calendar-week");
    await expect(week).toBeVisible();
    await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(week.locator(".calendar-week-col")).toHaveCount(7);
    await expect(week.locator(`.calendar-week-col[data-date="${today}"]`)).toBeVisible();

    // Exactly one initial range fetch, for the week (no month/day flash).
    expect(calendarRequests).toHaveLength(1);
    const url = new URL(calendarRequests[0]!);
    expect(url.searchParams.get("start")).toBe(startOfWeek(today));
    expect(url.searchParams.get("end")).toBe(addDays(startOfWeek(today), 7));
  });

  test("uses the configured default view from /api/me (month and day)", async ({ page }) => {
    const today = todayUtc();
    await page.route("**/api/me", (route) =>
      route.fulfill({
        json: { email: "owner@test.dev", actor_type: "human", calendar_default_view: "month", week_start_day: "sunday" },
      }),
    );

    const monthRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/planning/calendar")) monthRequests.push(req.url());
    });
    await page.goto("/calendar");
    await expect(page.locator(".calendar-grid")).toBeVisible();
    await expect(page.getByRole("button", { name: "Month", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "false");
    // The first (and only) fetch is the 42-day month grid — never a Week range.
    expect(monthRequests).toHaveLength(1);
    const monthUrl = new URL(monthRequests[0]!);
    expect(monthUrl.searchParams.get("start")).toBe(monthGridStart(today));
    expect(monthUrl.searchParams.get("end")).toBe(addDays(monthGridStart(today), 42));

    // Day configuration fetches only the single day.
    await page.unroute("**/api/me");
    await page.route("**/api/me", (route) =>
      route.fulfill({
        json: { email: "owner@test.dev", actor_type: "human", calendar_default_view: "day", week_start_day: "sunday" },
      }),
    );
    const dayRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/planning/calendar")) dayRequests.push(req.url());
    });
    await page.reload();
    await expect(page.locator("section[aria-label='Scheduled']")).toBeVisible();
    await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(dayRequests).toHaveLength(1);
    const dayUrl = new URL(dayRequests[0]!);
    expect(dayUrl.searchParams.get("start")).toBe(today);
    expect(dayUrl.searchParams.get("end")).toBe(addDays(today, 1));
  });

  test("keeps config-dependent inbox shortcuts disabled until /api/me resolves", async ({ page, request }) => {
    const created = await createIssue(request, { title: "Config loading inbox item", type: "task" });
    let releaseConfig!: () => void;
    const configPending = new Promise<void>((resolve) => {
      releaseConfig = resolve;
    });
    await page.route("**/api/me", async (route) => {
      await configPending;
      await route.fulfill({
        json: { email: "owner@test.dev", actor_type: "human", calendar_default_view: "week", week_start_day: "monday" },
      });
    });

    await page.goto("/inbox");
    const row = page.locator(".issue-row", { hasText: "Config loading inbox item" });
    await row.getByRole("button", { name: `Plan issue #${created.number}` }).click();
    const nextWeek = page.getByRole("menuitem", { name: "Next week", exact: true });
    try {
      await expect(nextWeek).toHaveAttribute("aria-disabled", "true");
    } finally {
      // Never leave the intercepted request pending during test teardown.
      releaseConfig();
    }
    await expect(nextWeek).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
  });

  test("Monday-first configuration rotates weeks, ranges, and inbox shortcuts", async ({ page, request }) => {
    const today = todayUtc();
    const monday = startOfWeekMonday(today);
    await page.route("**/api/me", (route) =>
      route.fulfill({
        json: { email: "owner@test.dev", actor_type: "human", calendar_default_view: "week", week_start_day: "monday" },
      }),
    );

    const calendarRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/planning/calendar")) calendarRequests.push(req.url());
    });

    // The week view renders Monday first: columns are ordered and labelled
    // Monday…Sunday, and the initial range fetch is the Monday-first week.
    await page.goto("/calendar");
    const week = page.locator(".calendar-week");
    await expect(week.locator(".calendar-week-col")).toHaveCount(7);
    await expect(week.locator(".calendar-week-col").first()).toHaveAttribute("data-date", monday);
    await expect(week.locator(".calendar-week-col").last()).toHaveAttribute("data-date", addDays(monday, 6));
    await expect(week.locator(".calendar-week-col").first()).toContainText("Mo");
    await expect(week.locator(".calendar-week-col").last()).toContainText("Su");

    expect(calendarRequests).toHaveLength(1);
    const url = new URL(calendarRequests[0]!);
    expect(url.searchParams.get("start")).toBe(monday);
    expect(url.searchParams.get("end")).toBe(addDays(monday, 7));

    // The month grid's weekday header row also starts on Monday.
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect(page.locator(".calendar-grid > div").first()).toHaveText("Mo");
    await expect(page.locator(".calendar-grid > div").nth(6)).toHaveText("Su");

    // Inbox: Next week schedules to the first day of the following
    // Monday-first week, and the issue leaves the inbox.
    const created = await createIssue(request, { title: "Monday first item", type: "task" });
    await page.goto("/inbox");
    const row = page.locator(".issue-row", { hasText: "Monday first item" });
    await row.getByRole("button", { name: `Plan issue #${created.number}` }).click();
    await page.getByRole("menuitem", { name: "Next week", exact: true }).click();
    await expect(row).toHaveCount(0);
    const stored = await getIssue(request, created.number);
    expect(stored.due_date).toBe(addDays(monday, 7));
  });

  test("month view shows due and scheduled entries, dual entries, and today", async ({ page, request }) => {
    const today = todayUtc();
    const tomorrow = addDays(today, 1);
    const dueTomorrow = await createIssue(request, { title: "Calendar due tomorrow", due_date: tomorrow });
    await createIssue(request, { title: "Calendar call today", scheduled_date: `${today}T09:00:00.000Z` });
    const dual = await createIssue(request, {
      title: "Calendar dual entry",
      due_date: today,
      scheduled_date: `${today}T10:30:00.000Z`,
    });

    await page.goto("/calendar");
    await page.getByRole("button", { name: "Month", exact: true }).click();

    const grid = page.locator(".calendar-grid");
    await expect(grid).toBeVisible();
    const todayCell = page.locator(`.calendar-day-cell[data-date="${today}"]`);
    await expect(todayCell).toBeVisible();
    await expect(todayCell.getByRole("button", { name: /, \d+ items?$/ })).toBeVisible();

    // A dual issue renders two separate entries (due + scheduled).
    await expect(todayCell.getByRole("link", { name: `Due — #${dual.number} Calendar dual entry` })).toBeVisible();
    await expect(
      todayCell.getByRole("link", { name: `Scheduled — #${dual.number} Calendar dual entry` }),
    ).toBeVisible();
    await expect(todayCell.getByRole("link", { name: /#\d+ Calendar call today/ })).toBeVisible();

    // A plain click on an entry still navigates (drag threshold is not met).
    const tomorrowCell = page.locator(`.calendar-day-cell[data-date="${tomorrow}"]`);
    await expect(tomorrowCell.getByRole("link", { name: `Due — #${dueTomorrow.number} Calendar due tomorrow` })).toBeVisible();
    await tomorrowCell.getByRole("link", { name: `Due — #${dueTomorrow.number} Calendar due tomorrow` }).click();
    await expect(page).toHaveURL(new RegExp(`/issues/${dueTomorrow.number}$`));
  });

  test("month view expands days with more than three entries", async ({ page, request }) => {
    const today = todayUtc();
    const [year, month, day] = today.split("-").map(Number);
    const target = `${year}-${String(month).padStart(2, "0")}-${day! <= 15 ? "25" : "05"}`;
    const created = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        createIssue(request, { title: `Month overflow ${index + 1}`, due_date: target }),
      ),
    );

    await page.goto("/calendar");
    await page.getByRole("button", { name: "Month", exact: true }).click();
    const cell = page.locator(`.calendar-day-cell[data-date="${target}"]`);
    await expect(cell.getByRole("link", { name: /Month overflow/ })).toHaveCount(3);
    await cell.getByRole("button", { name: "+1 more" }).click();
    await expect(cell.getByRole("link", { name: /Month overflow/ })).toHaveCount(4);
    await expect(cell.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");

    for (const issue of created) await apiJson(request, "POST", `/api/issues/${issue.number}/close`);
  });

  test("day view separates timed scheduled entries from all-day due entries", async ({ page, request }) => {
    const today = todayUtc();
    await createIssue(request, { title: "Day scheduled issue", scheduled_date: `${today}T09:00:00.000Z` });
    await createIssue(request, { title: "Day due issue", due_date: today });

    await page.goto("/calendar");
    await page.getByRole("button", { name: "Day", exact: true }).click();

    const scheduled = page.locator("section[aria-label='Scheduled']");
    const allDay = page.locator("section[aria-label='All day']");
    const dayScheduledLink = scheduled.getByRole("link", { name: /Day scheduled issue/ });
    await expect(dayScheduledLink.getByText("9:00 AM")).toBeVisible();
    await expect(dayScheduledLink).toBeVisible();
    await expect(scheduled.getByRole("link", { name: /Day due issue/ })).toHaveCount(0);
    await expect(allDay.getByRole("link", { name: /Day due issue/ })).toBeVisible();
    await expect(allDay.getByRole("link", { name: /Day scheduled issue/ })).toHaveCount(0);
  });

  test("lays out entries at the same minute side by side", async ({ page, request }) => {
    const today = todayUtc();
    const created = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        createIssue(request, {
          title: `Same-minute entry ${index + 1}`,
          scheduled_date: `${today}T13:15:00.000Z`,
        }),
      ),
    );

    await page.goto("/calendar");
    await page.getByRole("button", { name: "Day", exact: true }).click();
    const group = page.locator(".calendar-same-time-group", { hasText: "Same-minute entry 1" });
    await expect(group.getByRole("link", { name: /Same-minute entry/ })).toHaveCount(3);
    await expect(group).toHaveAttribute("style", /repeat\(3, minmax\(0(?:px)?, 1fr\)\)/);

    for (const issue of created) await apiJson(request, "POST", `/api/issues/${issue.number}/close`);
  });

  test("creates issues by clicking month, week, and day views", async ({ page, request }) => {
    const today = todayUtc();
    const weekDate = weekTarget(today);

    await page.goto("/calendar");
    await page.getByRole("button", { name: "Month", exact: true }).click();
    const todayCell = page.locator(`.calendar-day-cell[data-date="${today}"]`);
    await todayCell.locator(":scope > button").first().click();
    let dialog = page.getByRole("dialog", { name: "Create issue" });
    await expect(dialog).toContainText(`Due`);
    await dialog.getByLabel("Title").fill("Created from month click");
    let responsePromise = page.waitForResponse(
      (response) => response.url().endsWith("/api/issues") && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Create issue" }).click();
    const monthCreated = (await (await responsePromise).json()) as { number: number };
    await expect(todayCell.getByRole("link", { name: /Created from month click/ })).toBeVisible();

    await page.getByRole("button", { name: "Week", exact: true }).click();
    const weekColumn = page.locator(`.calendar-week-col[data-date="${weekDate}"]`);
    await weekColumn.locator(":scope > button").click();
    dialog = page.getByRole("dialog", { name: "Create issue" });
    await dialog.getByLabel("Title").fill("Created from week click");
    responsePromise = page.waitForResponse(
      (response) => response.url().endsWith("/api/issues") && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Create issue" }).click();
    const weekCreated = (await (await responsePromise).json()) as { number: number };
    await expect(weekColumn.getByRole("link", { name: /Created from week click/ })).toBeVisible();

    await page.getByRole("button", { name: "Day", exact: true }).click();
    const slot = page.locator('.calendar-time-slot[data-time="11:45"]');
    await slot.scrollIntoViewIfNeeded();
    await slot.click();
    dialog = page.getByRole("dialog", { name: "Create issue" });
    await expect(dialog).toContainText("at 11:45 AM");
    await dialog.getByLabel("Title").fill("Created from day click");
    responsePromise = page.waitForResponse(
      (response) => response.url().endsWith("/api/issues") && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Create issue" }).click();
    const created = (await (await responsePromise).json()) as { number: number };
    await expect(page.getByRole("link", { name: new RegExp(`Created from day click`) })).toBeVisible();

    const monthIssue = await getIssue(request, monthCreated.number);
    const weekIssue = await getIssue(request, weekCreated.number);
    expect(monthIssue.due_date).toBe(today);
    expect(weekIssue.due_date).toBe(weekDate);
    const dayIssue = await getIssue(request, created.number);
    expect(dayIssue.scheduled_date).toBe(`${today}T11:45:00.000Z`);

    // Keep the serial calendar fixture set sparse for the drag tests below.
    for (const number of [monthCreated.number, weekCreated.number, created.number]) {
      const closed = await apiJson(request, "POST", `/api/issues/${number}/close`);
      expect(closed.status).toBe(200);
    }
  });

  test("opens day time slots with the keyboard", async ({ page }) => {
    await page.goto("/calendar");
    await page.getByRole("button", { name: "Day", exact: true }).click();

    const slot = page.getByRole("button", { name: "Create an issue at 11:45 AM" });
    await slot.scrollIntoViewIfNeeded();
    await slot.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Create issue" })).toContainText("at 11:45 AM");
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("drags a scheduled entry in day view to set its time", async ({ page, request }) => {
    const today = todayUtc();
    const scheduled = await createIssue(request, {
      title: "Day timeline drag",
      scheduled_date: `${today}T09:00:00.000Z`,
    });

    await page.goto("/calendar");
    await page.getByRole("button", { name: "Day", exact: true }).click();

    const timeline = page.locator(".calendar-day-timeline");
    const entry = timeline.locator(".calendar-entry", { hasText: "Day timeline drag" });
    const target = timeline.locator('.calendar-time-slot[data-time="10:30"]');
    await expect(entry).toBeVisible();
    await target.scrollIntoViewIfNeeded();
    await pointerDrag(page, entry, target, async () => {
      await expect(target).toHaveClass(/calendar-time-drop-target/);
    });

    await expect(entry.getByText("10:30 AM")).toBeVisible();
    await expect(page).toHaveURL(/\/calendar$/);
    const stored = await getIssue(request, scheduled.number);
    expect(stored.scheduled_date).toBe(`${today}T10:30:00.000Z`);
  });

  test("week view renders seven dated columns and entry times", async ({ page, request }) => {
    const today = todayUtc();
    const target = weekTarget(today);
    await createIssue(request, { title: "Week scheduled issue", scheduled_date: `${target}T14:30:00.000Z` });
    await createIssue(request, { title: "Week due issue", due_date: today });

    await page.goto("/calendar");

    const week = page.locator(".calendar-week");
    await expect(week.locator(".calendar-week-col")).toHaveCount(7);
    const todayCol = week.locator(`.calendar-week-col[data-date="${today}"]`);
    const targetCol = week.locator(`.calendar-week-col[data-date="${target}"]`);
    await expect(todayCol.getByRole("link", { name: /Week due issue/ })).toBeVisible();
    await expect(targetCol.getByRole("link", { name: /Week scheduled issue/ })).toBeVisible();
    await expect(targetCol.getByText("2:30 PM")).toBeVisible();
  });

  test("previews a calendar entry on hover", async ({ page, request }) => {
    const today = todayUtc();
    const previewed = await createIssue(request, {
      title: "Calendar hover preview",
      body: "Details shown from the calendar hover card.",
      type: "decision",
      labels: ["calendar-preview"],
      due_date: today,
    });

    await page.goto("/calendar");
    await page.getByRole("link", { name: `Due — #${previewed.number} Calendar hover preview` }).hover();

    const card = page.locator(".issue-hover-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Calendar hover preview");
    await expect(card).toContainText(`#${previewed.number}`);
    await expect(card).toContainText("Details shown from the calendar hover card.");
    await expect(card.locator(".chip", { hasText: "calendar-preview" })).toBeVisible();
  });

  test("previous/next/today navigation moves across months and empty ranges", async ({ page, request }) => {
    const today = todayUtc();
    const [y, m] = today.split("-").map(Number);
    const currentLabel = `${new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${y}`;
    const nextMonth = m === 12 ? 1 : m! + 1;
    const nextYear = m === 12 ? y! + 1 : y!;
    const nextLabel = `${new Date(Date.UTC(nextYear, nextMonth - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${nextYear}`;

    const nextMonthFixture = await createIssue(request, {
      title: "Calendar next month fixture",
      due_date: addDays(firstOfNextMonth(today), 5),
    });

    await page.goto("/calendar");
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect(page.getByText(currentLabel)).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(nextLabel)).toBeVisible();
    await expect(page.locator(".calendar-entry", { hasText: `#${nextMonthFixture.number}` })).toBeVisible();

    // Back two months from the current month: an empty grid with a clear
    // empty state, then Today restores the current month.
    await page.getByRole("button", { name: "Previous" }).click();
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByText("No planned work in this month.")).toBeVisible();
    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByText(currentLabel)).toBeVisible();
    await expect(page.locator(`.calendar-day-cell[data-date="${today}"]`)).toBeVisible();
  });

  test("reconciles an in-flight move against the latest range after a view change", async ({ page, request }) => {
    const today = todayUtc();
    const target = weekTarget(today);
    const due = await createIssue(request, { title: "Navigate during move", due_date: today });
    let releasePatch!: () => void;
    const patchPending = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    await page.route("**/api/issues/*", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await patchPending;
      await route.continue();
    });

    try {
      await page.goto("/calendar");
      await page.getByRole("button", { name: "Day", exact: true }).click();
      const row = page.locator("li", { hasText: "Navigate during move" });
      await row.getByRole("button", { name: "Move date…" }).click();
      await page.getByRole("textbox", { name: "Move date" }).fill(target);
      await expect(row).toHaveCount(0); // optimistic move leaves the day range

      // Change range while PATCH is pending. This fetch still sees the original
      // date; when PATCH settles, reconciliation must use the now-visible week.
      await page.getByRole("button", { name: "Week", exact: true }).click();
      const todayColumn = page.locator(`.calendar-week-col[data-date="${today}"]`);
      const targetColumn = page.locator(`.calendar-week-col[data-date="${target}"]`);
      await expect(todayColumn.getByRole("link", { name: /Navigate during move/ })).toBeVisible();
      releasePatch();
      await expect(targetColumn.getByRole("link", { name: /Navigate during move/ })).toBeVisible();
      await expect(todayColumn.getByRole("link", { name: /Navigate during move/ })).toHaveCount(0);
      const stored = await getIssue(request, due.number);
      expect(stored.due_date).toBe(target);
    } finally {
      // Never leave the intercepted request pending during test teardown.
      releasePatch();
    }
  });

  test("drags a due entry to another date (pointer, with target styling)", async ({ page, request }) => {
    const today = todayUtc();
    const target = weekTarget(today);
    const due = await createIssue(request, { title: "Drag due entry", due_date: today });
    await page.goto("/calendar");

    const entry = page.locator(".calendar-entry", { hasText: "Drag due entry" });
    const targetCol = page.locator(`.calendar-week-col[data-date="${target}"]`);
    await expect(entry).toBeVisible();

    await pointerDrag(page, entry, targetCol, async () => {
      // Mid-drag, the hovered drop target is highlighted.
      await expect(targetCol).toHaveClass(/calendar-drop-target/);
    });

    await expect(targetCol.getByRole("link", { name: /Drag due entry/ })).toBeVisible();
    await expect(page.locator(`.calendar-week-col[data-date="${today}"]`).getByRole("link", { name: /Drag due entry/ })).toHaveCount(0);
    // No navigation happened.
    await expect(page).toHaveURL(/\/calendar$/);
    const stored = await getIssue(request, due.number);
    expect(stored.due_date).toBe(target);
  });

  test("drags a scheduled entry preserving the viewer-local wall-clock time", async ({ page, request }) => {
    const today = todayUtc();
    const target = weekTarget(today);
    const scheduled = await createIssue(request, {
      title: "Drag scheduled entry",
      scheduled_date: `${today}T09:00:00.000Z`,
    });
    await page.goto("/calendar");

    const persisted = page.waitForResponse((response) =>
      response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/issues/${scheduled.number}`,
    );
    await pointerDrag(
      page,
      page.locator(".calendar-entry", { hasText: "Drag scheduled entry" }),
      page.locator(`.calendar-week-col[data-date="${target}"]`),
    );
    expect((await persisted).ok()).toBe(true);

    const targetCol = page.locator(`.calendar-week-col[data-date="${target}"]`);
    await expect(targetCol.getByRole("link", { name: /Drag scheduled entry/ })).toBeVisible();
    await expect(targetCol.getByText("9:00 AM")).toBeVisible();
    const stored = await getIssue(request, scheduled.number);
    expect(stored.scheduled_date).toBe(`${target}T09:00:00.000Z`);
  });

  test("moves the entries of a dual issue independently", async ({ page, request }) => {
    const today = todayUtc();
    const target = weekTarget(today);
    const dual = await createIssue(request, {
      title: "Drag dual entry",
      due_date: today,
      scheduled_date: `${today}T10:30:00.000Z`,
    });
    await page.goto("/calendar");

    // Move only the due entry (the entry's accessible name includes its kind).
    await pointerDrag(
      page,
      page.getByRole("link", { name: `Due — #${dual.number} Drag dual entry` }),
      page.locator(`.calendar-week-col[data-date="${target}"]`),
    );
    let stored = await getIssue(request, dual.number);
    expect(stored.due_date).toBe(target);
    expect(stored.scheduled_date).toBe(`${today}T10:30:00.000Z`);

    // Then move only the scheduled entry (still in today's column); the due
    // date is untouched.
    const secondTarget = otherWeekDay(today, target);
    await page.getByRole("button", { name: "Day", exact: true }).click();
    const scheduledLink = page.getByRole("link", { name: `Scheduled — #${dual.number} Drag dual entry` });
    const scheduledRow = scheduledLink.locator("xpath=../../..");
    await scheduledRow.getByRole("button", { name: "Move date…" }).click();
    await page.getByRole("textbox", { name: "Move date" }).fill(secondTarget);
    await expect(scheduledLink).toHaveCount(0);
    stored = await getIssue(request, dual.number);
    expect(stored.due_date).toBe(target);
    expect(stored.scheduled_date).toBe(`${secondTarget}T10:30:00.000Z`);
  });

  test("rolls back a failed move with a non-destructive alert", async ({ page, request }) => {
    const today = todayUtc();
    const target = weekTarget(today);
    const due = await createIssue(request, { title: "Rollback due entry", due_date: today });
    await page.goto("/calendar");

    await page.route("**/api/issues/*", (route) => {
      if (route.request().method() === "PATCH") {
        return route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "boom" } } });
      }
      return route.continue();
    });
    await pointerDrag(
      page,
      page.locator(".calendar-entry", { hasText: "Rollback due entry" }),
      page.locator(`.calendar-week-col[data-date="${target}"]`),
    );

    // Optimistic position appears first, then the failed PATCH rolls back
    // and the alert explains the failure.
    await expect(page.getByRole("alert")).toContainText("Couldn't move");
    await expect(page.locator(`.calendar-week-col[data-date="${target}"]`).getByRole("link", { name: /Rollback due entry/ })).toHaveCount(0);
    await expect(page.locator(`.calendar-week-col[data-date="${today}"]`).getByRole("link", { name: /Rollback due entry/ })).toBeVisible();
    const stored = await getIssue(request, due.number);
    expect(stored.due_date).toBe(today);

    await page.unroute("**/api/issues/*");
    await page.getByRole("button", { name: "Dismiss notice" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("moves an entry with the keyboard", async ({ page, request }) => {
    const today = todayUtc();
    const target = weekTarget(today);
    const due = await createIssue(request, { title: "Keyboard due entry", due_date: today });
    await page.goto("/calendar");

    const handle = page.locator(".calendar-drag-handle", { hasText: "Keyboard due entry" });
    await handle.focus();
    await page.keyboard.press("Space"); // pick up
    // Wait for dnd-kit to measure drop targets and establish the initial `over`.
    await expect(page.getByRole("status")).toContainText("Moved over");
    await page.keyboard.press(weekday(today) === 6 ? "ArrowLeft" : "ArrowRight");
    await expect(page.locator(`.calendar-week-col[data-date="${target}"]`)).toHaveClass(/calendar-drop-target/);
    await page.keyboard.press("Space"); // drop

    await expect(page.locator(`.calendar-week-col[data-date="${target}"]`).getByRole("link", { name: /Keyboard due entry/ })).toBeVisible();
    await expect(page.locator(`.calendar-week-col[data-date="${today}"]`).getByRole("link", { name: /Keyboard due entry/ })).toHaveCount(0);
    const stored = await getIssue(request, due.number);
    expect(stored.due_date).toBe(target);
  });

  test("moves day-view entries with Inbox-style date shortcuts", async ({ page, request }) => {
    const today = todayUtc();
    const cases = [
      { title: "Shortcut tomorrow entry", shortcut: "Tomorrow", expected: addDays(today, 1) },
      { title: "Shortcut next week entry", shortcut: "Next week", expected: addDays(startOfWeek(today), 7) },
      { title: "Shortcut next month entry", shortcut: "Next month", expected: firstOfNextMonth(today) },
    ];
    const issues = await Promise.all(
      cases.map(({ title }) => createIssue(request, { title, due_date: today })),
    );

    await page.goto("/calendar");
    await page.getByRole("button", { name: "Day", exact: true }).click();

    for (const [index, testCase] of cases.entries()) {
      const row = page.locator("li", { hasText: testCase.title });
      await row.getByRole("button", { name: "Move date…" }).click();
      // The accessible popover is portaled outside the row.
      await page.getByRole("button", { name: testCase.shortcut, exact: true }).click();

      await expect(row).toHaveCount(0);
      const stored = await getIssue(request, issues[index]!.number);
      expect(stored.due_date).toBe(testCase.expected);
    }
  });

  test("moves a day-view entry with the Move date… fallback picker", async ({ page, request }) => {
    const today = todayUtc();
    const target = weekTarget(today);
    const due = await createIssue(request, { title: "Picker due entry", due_date: today });

    await page.goto("/calendar");
    await page.getByRole("button", { name: "Day", exact: true }).click();

    const row = page.locator("li", { hasText: "Picker due entry" });
    await row.getByRole("button", { name: "Move date…" }).click();
    await expect(page.getByRole("textbox", { name: "Move date" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "Move date" })).toHaveCount(0);

    await row.getByRole("button", { name: "Move date…" }).click();
    // DatePicker commits as soon as the typed value becomes a valid ISO date.
    await page.getByRole("textbox", { name: "Move date" }).fill(target);

    await expect(page.locator("li", { hasText: "Picker due entry" })).toHaveCount(0);
    const stored = await getIssue(request, due.number);
    expect(stored.due_date).toBe(target);
  });

  test("a failed range fetch shows an error and Retry recovers", async ({ page, request }) => {
    await createIssue(request, { title: "Retry fixture", due_date: todayUtc() });
    await page.route("**/api/planning/calendar*", (route) => route.abort());
    await page.goto("/calendar");
    await expect(page.getByText(/Failed to fetch|Load failed|NetworkError|aborted/i)).toBeVisible();
    await page.unroute("**/api/planning/calendar*");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator(".calendar-week")).toBeVisible();
  });

  test("narrow screens render and reschedule without horizontal document overflow", async ({ page, request }) => {
    const today = todayUtc();
    const target = weekTarget(today);
    await createIssue(request, { title: "Mobile drag entry", due_date: today });
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/calendar");
    await expect(page.locator(".calendar-week")).toBeVisible();
    let overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Dragging works at mobile width too (pointer sensor).
    const mobileEntry = page.locator(".calendar-entry", { hasText: "Mobile drag entry" });
    const mobileTarget = page.locator(`.calendar-week-col[data-date="${target}"]`);
    await mobileTarget.scrollIntoViewIfNeeded();
    await expect(mobileEntry).toBeInViewport();
    await pointerDrag(
      page,
      mobileEntry,
      mobileTarget,
      async () => expect(mobileTarget).toHaveClass(/calendar-drop-target/),
    );
    await expect(page.locator(`.calendar-week-col[data-date="${target}"]`).getByRole("link", { name: /Mobile drag entry/ })).toBeVisible();
    overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Month grid also stays contained.
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect(page.locator(".calendar-grid")).toBeVisible();
    overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
