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
  await page.route("**/api/issue-views", (route) => route.fulfill({ json: [] }));
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

type SavedView = {
  id: string;
  name: string;
  filters: { query: string; status: "open" | "closed" | null; types: string[]; labels: string[] };
  created_at: string;
  updated_at: string;
};

async function mockSavedViews(page: Page, initial: SavedView[] = []) {
  const issueRequests: URL[] = [];
  const mutations: { method: string; body: Record<string, unknown> | null }[] = [];
  const views = [...initial];
  await page.route("**/api/me", (route) => route.fulfill({
    json: {
      email: "owner@test.dev",
      actor_type: "human",
      calendar_default_view: "week",
      week_start_day: "sunday",
      issues_default_limit: 20,
    },
  }));
  await page.route("**/api/issue-views**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const id = url.pathname.split("/").at(-1)!;
    const body = method === "GET" || method === "DELETE" ? null : request.postDataJSON() as Record<string, unknown>;
    if (method !== "GET") mutations.push({ method, body });
    if (method === "GET") return route.fulfill({ json: views });
    if (method === "POST") {
      const now = "2025-01-01T00:00:00.000Z";
      const created = { id: "view-created", name: String(body?.name), filters: body?.filters, created_at: now, updated_at: now } as SavedView;
      views.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    const index = views.findIndex((view) => view.id === id);
    if (method === "PATCH" && index >= 0) {
      views[index] = { ...views[index]!, ...body, updated_at: "2025-01-02T00:00:00.000Z" } as SavedView;
      return route.fulfill({ json: views[index] });
    }
    if (method === "DELETE" && index >= 0) {
      views.splice(index, 1);
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found" } } });
  });
  await page.route("**/api/issues?*", (route) => {
    const url = new URL(route.request().url());
    issueRequests.push(url);
    return route.fulfill({ json: { issues: [issue(1)], total: 1 } });
  });
  return { issueRequests, mutations, views };
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

test("loads a saved tab from the URL and applies its filters after reload", async ({ page }) => {
  const saved: SavedView = {
    id: "view-bugs",
    name: "Bug triage",
    filters: { query: "crash", status: "closed", types: ["bug"], labels: ["urgent"] },
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
  };
  const { issueRequests } = await mockSavedViews(page, [saved]);
  await page.goto("/issues?view=view-bugs");

  await expect(page.getByRole("tab", { name: "Bug triage" })).toHaveAttribute("data-state", "active");
  await expect(page.getByRole("searchbox", { name: "Keyword" })).toHaveValue("crash");
  await expect(page.getByRole("checkbox", { name: "bug" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "urgent" })).toBeChecked();
  expect(issueRequests.at(-1)?.searchParams.get("q")).toBe("crash");
  expect(issueRequests.at(-1)?.searchParams.get("status")).toBe("closed");
  expect(issueRequests.at(-1)?.searchParams.getAll("type")).toEqual(["bug"]);
  expect(issueRequests.at(-1)?.searchParams.getAll("label")).toEqual(["urgent"]);

  await page.reload();
  await expect(page.getByRole("tab", { name: "Bug triage" })).toHaveAttribute("data-state", "active");
});

test("creates a tab from current filters without saving pagination", async ({ page }) => {
  const { mutations } = await mockSavedViews(page);
  await page.goto("/issues");

  await page.getByRole("combobox", { name: "Filter by status" }).click();
  await page.getByRole("option", { name: "Closed" }).click();
  await page.getByRole("checkbox", { name: "bug" }).check();
  await page.getByRole("searchbox", { name: "Keyword" }).fill("regression");
  await page.getByRole("button", { name: "Save current filters as a tab" }).click();
  await page.getByRole("textbox", { name: "Tab name" }).fill("Regressions");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page).toHaveURL(/\/issues\?view=view-created$/);
  await expect(page.getByRole("tab", { name: "Regressions" })).toHaveAttribute("data-state", "active");
  const create = mutations.find((mutation) => mutation.method === "POST")!;
  expect(create.body).toEqual({
    name: "Regressions",
    filters: { query: "regression", status: "closed", types: ["bug"], labels: [] },
  });
  expect(create.body).not.toHaveProperty("limit");
  expect(create.body).not.toHaveProperty("page");
});

test("saves, renames, and deletes a saved tab", async ({ page }) => {
  const saved: SavedView = {
    id: "view-work",
    name: "Work",
    filters: { query: "", status: "open", types: [], labels: [] },
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
  };
  const { mutations } = await mockSavedViews(page, [saved]);
  await page.goto("/issues?view=view-work");

  await page.getByRole("searchbox", { name: "Keyword" }).fill("focused");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Work" })).not.toContainText("*");

  await page.getByRole("button", { name: "Saved tab actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Tab name" }).fill("Focused work");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Focused work" })).toBeVisible();

  await page.getByRole("button", { name: "Saved tab actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/issues$/);
  await expect(page.getByRole("tab", { name: "Focused work" })).toHaveCount(0);
  expect(mutations.map((mutation) => mutation.method)).toEqual(["PATCH", "PATCH", "DELETE"]);
});

test("prompts before discarding modified filters on tab navigation", async ({ page }) => {
  const saved: SavedView = {
    id: "view-work",
    name: "Work",
    filters: { query: "", status: "open", types: [], labels: [] },
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
  };
  await mockSavedViews(page, [saved]);
  await page.goto("/issues?view=view-work");
  await page.getByRole("searchbox", { name: "Keyword" }).fill("unsaved");

  await page.getByRole("tab", { name: "Open" }).click();
  await expect(page.getByRole("dialog", { name: "Save filter changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/view=view-work$/);

  await page.getByRole("tab", { name: "Open" }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(/\/issues$/);
  await expect(page.getByRole("tab", { name: "Open" })).toHaveAttribute("data-state", "active");
});

test("falls back to Open when the URL references a missing view", async ({ page }) => {
  await mockSavedViews(page);
  await page.goto("/issues?view=missing");
  await expect(page).toHaveURL(/\/issues$/);
  await expect(page.getByRole("tab", { name: "Open" })).toHaveAttribute("data-state", "active");
});

test("canceling a blocked Forward keeps the forward entry reachable", async ({ page }) => {
  const saved: SavedView = {
    id: "view-work",
    name: "Work",
    filters: { query: "", status: "open", types: [], labels: [] },
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
  };
  await mockSavedViews(page, [saved]);
  await page.route("**/api/planning/inbox", (route) => route.fulfill({ json: [] }));
  await page.goto("/issues?view=view-work");

  // Leave the Issues page so there is a forward entry to return to.
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/);

  // Come back and make the filters dirty.
  await page.goBack();
  await expect(page).toHaveURL(/view=view-work$/);
  await page.getByRole("searchbox", { name: "Keyword" }).fill("unsaved");

  // Forward onto the Inbox: the guard fires; canceling must restore the
  // Issues page without pushing (which would discard the forward entry).
  await page.goForward();
  await expect(page.getByRole("dialog", { name: "Save filter changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/view=view-work$/);

  // The canceled destination is still there: forward again and discard.
  await page.goForward();
  await expect(page.getByRole("dialog", { name: "Save filter changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/);
});
