/**
 * Calendar workspace (browser): routing, navigation, views, accessibility
 * selectors, issue links, loading failures, and narrow-screen rendering.
 *
 * The context runs in UTC (timezoneId) so fixture dates computed in the test
 * process match the browser's "today" and the worker's tz parameter exactly.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

test.use({ timezoneId: "UTC" });

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

test.describe.serial("Calendar workspace", () => {
  test("redirects /upcoming to /calendar and marks the Calendar nav active", async ({ page }) => {
    // Old-route compatibility: the URL is replaced in place (no duplicate
    // history entry) and the canonical page renders.
    await page.goto("/upcoming");
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Upcoming" })).toHaveCount(0);

    // Direct loading of the canonical route works too.
    await page.goto("/calendar");
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
  });

  test("month view shows due and scheduled entries, dual entries, and today", async ({ page, request }) => {
    const today = todayUtc();
    const tomorrow = addDays(today, 1);
    const dueTomorrow = await apiJson(request, "POST", "/api/issues", {
      title: "Calendar due tomorrow",
      due_date: tomorrow,
    });
    expect(dueTomorrow.status).toBe(201);
    const tomorrowNumber = (dueTomorrow.json as { number: number }).number;

    await apiJson(request, "POST", "/api/issues", {
      title: "Calendar call today",
      scheduled_date: `${today}T09:00:00.000Z`,
    });

    const dual = await apiJson(request, "POST", "/api/issues", {
      title: "Calendar dual entry",
      due_date: today,
      scheduled_date: `${today}T10:30:00.000Z`,
    });
    const dualNumber = (dual.json as { number: number }).number;

    await page.goto("/calendar");

    // The view defaults to the current month and highlights today.
    const grid = page.locator(".calendar-grid");
    await expect(grid).toBeVisible();
    const todayCell = page.locator(`.calendar-day-cell[data-date="${today}"]`);
    await expect(todayCell).toBeVisible();
    await expect(todayCell.getByRole("button", { name: /, \d+ items?$/ })).toBeVisible();

    // A dual issue renders two separate entries (due + scheduled) so neither
    // planning signal is hidden.
    await expect(todayCell.getByRole("link", { name: `Due — #${dualNumber} Calendar dual entry` })).toBeVisible();
    await expect(
      todayCell.getByRole("link", { name: `Scheduled — #${dualNumber} Calendar dual entry` }),
    ).toBeVisible();
    await expect(todayCell.getByRole("link", { name: /#\d+ Calendar call today/ })).toBeVisible();

    // Tomorrow's due entry sits in tomorrow's cell and links to the issue.
    const tomorrowCell = page.locator(`.calendar-day-cell[data-date="${tomorrow}"]`);
    await expect(tomorrowCell.getByRole("link", { name: `Due — #${tomorrowNumber} Calendar due tomorrow` })).toBeVisible();
    await tomorrowCell.getByRole("link", { name: `Due — #${tomorrowNumber} Calendar due tomorrow` }).click();
    await expect(page).toHaveURL(new RegExp(`/issues/${tomorrowNumber}$`));
  });

  test("day view separates timed scheduled entries from all-day due entries", async ({ page, request }) => {
    const today = todayUtc();
    await apiJson(request, "POST", "/api/issues", {
      title: "Day scheduled issue",
      scheduled_date: `${today}T09:00:00.000Z`,
    });
    await apiJson(request, "POST", "/api/issues", {
      title: "Day due issue",
      due_date: today,
    });

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

  test("week view renders seven dated columns and entry times", async ({ page, request }) => {
    const today = todayUtc();
    const tomorrow = addDays(today, 1);
    await apiJson(request, "POST", "/api/issues", {
      title: "Week scheduled issue",
      scheduled_date: `${tomorrow}T14:30:00.000Z`,
    });
    await apiJson(request, "POST", "/api/issues", {
      title: "Week due issue",
      due_date: today,
    });

    await page.goto("/calendar");
    await page.getByRole("button", { name: "Week", exact: true }).click();

    const week = page.locator(".calendar-week");
    await expect(week.locator(".calendar-week-col")).toHaveCount(7);
    const todayCol = week.locator(`.calendar-week-col[data-date="${today}"]`);
    const tomorrowCol = week.locator(`.calendar-week-col[data-date="${tomorrow}"]`);
    await expect(todayCol.getByRole("link", { name: /Week due issue/ })).toBeVisible();
    await expect(tomorrowCol.getByRole("link", { name: /Week scheduled issue/ })).toBeVisible();
    await expect(tomorrowCol.getByText("2:30 PM")).toBeVisible();
  });

  test("previous/next/today navigation moves across months and empty ranges", async ({ page, request }) => {
    const today = todayUtc();
    const [y, m] = today.split("-").map(Number);
    const monthName = new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    const currentLabel = `${monthName} ${y}`;
    const nextMonth = m === 12 ? 1 : m! + 1;
    const nextYear = m === 12 ? y! + 1 : y!;
    const nextLabel = `${new Date(Date.UTC(nextYear, nextMonth - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${nextYear}`;

    const nextMonthFixture = await apiJson(request, "POST", "/api/issues", {
      title: "Calendar next month fixture",
      due_date: addDays(firstOfNextMonth(today), 5),
    });
    const nextFixtureNumber = (nextMonthFixture.json as { number: number }).number;

    await page.goto("/calendar");
    await expect(page.getByText(currentLabel)).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(nextLabel)).toBeVisible();
    await expect(page.locator(".calendar-entry", { hasText: `#${nextFixtureNumber}` })).toBeVisible();

    // Back two months from the current month: an empty grid with a clear
    // empty state, then Today restores the current month.
    await page.getByRole("button", { name: "Previous" }).click();
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByText("No planned work in this month.")).toBeVisible();
    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByText(currentLabel)).toBeVisible();
    await expect(page.locator(`.calendar-day-cell[data-date="${today}"]`)).toBeVisible();
  });

  test("a failed range fetch shows an error and Retry recovers", async ({ page }) => {
    await page.route("**/api/planning/calendar*", (route) => route.abort());
    await page.goto("/calendar");
    await expect(page.getByText(/Failed to fetch|Load failed|NetworkError|aborted/i)).toBeVisible();
    await page.unroute("**/api/planning/calendar*");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator(".calendar-grid")).toBeVisible();
  });

  test("narrow screens render without horizontal document overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/calendar");
    await expect(page.locator(".calendar-grid")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(page.locator(".calendar-week")).toBeVisible();
    const weekOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(weekOverflow).toBeLessThanOrEqual(1);
  });
});
