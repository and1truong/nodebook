/** Issues list pagination and deployment-configured page size. */
import { expect, test, type Page } from "@playwright/test";

const TOTAL_ISSUES = 45;

function issue(number: number) {
  const timestamp = "2025-01-01T00:00:00.000Z";
  return {
    id: `issue-${number}`,
    number,
    type: "task",
    title: `Paginated issue ${number}`,
    body: "",
    status: "open",
    priority: null,
    labels: [],
    start_date: null,
    due_date: null,
    scheduled_date: null,
    timezone: "UTC",
    recurrence_rule: null,
    parent_id: null,
    parent_number: null,
    created_by: "owner@test.dev",
    created_at: timestamp,
    updated_at: timestamp,
    version: 1,
    closed_at: null,
    completed_at: null,
    child_count: 0,
    backlink_count: 0,
  };
}

async function mockIssueList(page: Page, defaultLimit: 20 | 50 | 100) {
  const requests: URL[] = [];
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        email: "owner@test.dev",
        actor_type: "human",
        calendar_default_view: "week",
        week_start_day: "sunday",
        issues_default_limit: defaultLimit,
      },
    }),
  );
  await page.route("**/api/issues?*", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset"));
    const issues = Array.from({ length: TOTAL_ISSUES }, (_, index) => issue(TOTAL_ISSUES - index));
    return route.fulfill({ json: { issues: issues.slice(offset, offset + limit), total: TOTAL_ISSUES } });
  });
  return requests;
}

test("uses the configured Issues page limit", async ({ page }) => {
  const requests = await mockIssueList(page, 50);
  await page.goto("/issues");

  await expect(page.locator(".issue-row")).toHaveCount(TOTAL_ISSUES);
  await expect(page.getByRole("combobox", { name: "Rows per page" })).toContainText("50");
  expect(requests[0]?.searchParams.get("limit")).toBe("50");
  expect(requests[0]?.searchParams.get("offset")).toBe("0");
});

test("pages results and offers 20, 50, and 100 rows in the footer", async ({ page }) => {
  const requests = await mockIssueList(page, 20);
  await page.goto("/issues");

  await expect(page.locator(".issue-row")).toHaveCount(20);
  await expect(page.getByLabel("Issue pagination")).toContainText("1–20 of 45");

  await page.getByRole("button", { name: "Next issue page" }).click();
  await expect(page.getByLabel("Issue pagination")).toContainText("21–40 of 45");
  expect(requests.at(-1)?.searchParams.get("offset")).toBe("20");

  const pageLimit = page.getByRole("combobox", { name: "Rows per page" });
  await pageLimit.click();
  await page.getByRole("option", { name: "50", exact: true }).click();
  await expect(page.locator(".issue-row")).toHaveCount(TOTAL_ISSUES);
  await expect(page.getByLabel("Issue pagination")).toContainText("1–45 of 45");

  await pageLimit.click();
  await page.getByRole("option", { name: "100", exact: true }).click();
  await expect(page.locator(".issue-row")).toHaveCount(TOTAL_ISSUES);
  expect(requests.at(-1)?.searchParams.get("limit")).toBe("100");
  expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
});
