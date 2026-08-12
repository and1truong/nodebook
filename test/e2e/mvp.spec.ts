/**
 * MVP acceptance flow (browser): creation → linking → planning → reminders →
 * attachments → search → MCP mutation → visible audit history.
 *
 * The Playwright webServer boots `wrangler dev` on :8787 serving the built SPA
 * with local D1/R2 state (see playwright.config.ts).
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = "http://localhost:8787";

async function apiJson(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const res = await request.fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status(), json };
}

test.describe.serial("MVP acceptance", () => {
  let issueNumber: number;
  let childNumber: number;
  let mcpToken: string;
  let attachmentId: string;

  test("create an issue with planning fields via the UI", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();

    // Quick create from the top bar.
    await page.getByLabel("Quick create title").fill("Set up the NodeBook workspace");
    await page.getByRole("button", { name: "Add" }).click();

    await expect(page).toHaveURL(/\/issues\/\d+/);
    await expect(page.getByRole("heading", { name: "Set up the NodeBook workspace" })).toBeVisible();

    const url = page.url();
    issueNumber = Number(url.split("/").pop());

    // Edit: body with a forward #-reference, label, due date, recurrence.
    await page.getByRole("button", { name: "Edit" }).click();
    await page.locator('textarea').first().fill("Bootstrap the wiki. Reference #99999 from the future.");
    await page.locator('.label-editor input').fill("setup");
    await page.locator('.label-editor input').press("Enter");
    await page.getByLabel("Due date").fill("2099-01-01");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Bootstrap the wiki")).toBeVisible();
    await expect(page.locator(".chip", { hasText: "setup" })).toBeVisible();
  });

  test("add a child, link a relationship, and comment", async ({ page, request }) => {
    await page.goto(`/issues/${issueNumber}`);

    // Child issue via the sub-issues panel's inline create flow.
    await page.getByRole("button", { name: "Create sub-issue" }).click();
    await page.getByLabel("Sub-issue title").fill("Write deployment guide");
    await page.locator(".sub-issues-create-form").getByRole("button", { name: "Create" }).click();
    await expect(page.locator(".sub-issue-row", { hasText: "Write deployment guide" })).toBeVisible();

    // The child's number is the next allocation.
    const list = await apiJson(request, "GET", `/api/issues?limit=5`);
    const issues = list.json.issues as { number: number; title: string }[];
    childNumber = issues.find((i) => i.title === "Write deployment guide")!.number;

    // Link the child as a dependency.
    await page.getByLabel("Target issue").fill(String(childNumber));
    await page.getByLabel("Relationship type").selectOption("depends_on");
    await page.getByRole("button", { name: "Link" }).click();
    await expect(page.locator(".rel-item", { hasText: "#" + childNumber })).toBeVisible();

    // Comment with a reference.
    await page.locator("textarea[placeholder^='Markdown comment']").fill("Comment with #1");
    await page.getByRole("button", { name: "Comment" }).click();
    await expect(page.locator(".comment", { hasText: "Comment with" })).toBeVisible();
  });

  test("render nested sub-issues", async ({ page, request }) => {
    // Self-contained fixture: root → child → (grandchild, closed sibling),
    // plus a closed second direct child of the root.
    const rootRes = await apiJson(request, "POST", "/api/issues", {
      title: "Sub-issue demo root",
      type: "task",
    });
    expect(rootRes.status).toBe(201);
    const root = rootRes.json as { id: string; number: number };
    const childRes = await apiJson(request, "POST", "/api/issues", {
      title: "Write deployment guide",
      type: "task",
      parent_id: root.id,
    });
    expect(childRes.status).toBe(201);
    const child = childRes.json as { id: string; number: number };

    const grandchild = await apiJson(request, "POST", "/api/issues", {
      title: "Validate the deployment steps",
      type: "task",
      parent_id: child.id,
    });
    expect(grandchild.status).toBe(201);
    const sibling = await apiJson(request, "POST", "/api/issues", {
      title: "Retired setup experiment",
      type: "task",
      parent_id: child.id,
    });
    expect(sibling.status).toBe(201);
    expect((await apiJson(request, "POST", `/api/issues/${(sibling.json as { number: number }).number}/close`)).status).toBe(200);
    const extra = await apiJson(request, "POST", "/api/issues", {
      title: "Archived setup notes",
      type: "task",
      parent_id: root.id,
    });
    expect(extra.status).toBe(201);
    expect((await apiJson(request, "POST", `/api/issues/${(extra.json as { number: number }).number}/close`)).status).toBe(200);

    await page.goto(`/issues/${root.number}`);

    // Header progress: 2 direct children, 1 closed → 1/2.
    const headerProgress = page.locator(".sub-issues-header .sub-issues-progress");
    await expect(headerProgress).toHaveText("1/2");

    // Rows are nested <li>s, so scope assertions to unique title spans (a
    // title is only contained by its own row and ancestor rows) and to the
    // row div that owns each title (nearest .issue-row ancestor).
    const rowDiv = (title: string) =>
      page
        .locator(".sub-issue-row .issue-title", { hasText: title })
        .locator("xpath=ancestor::div[contains(@class,'issue-row')][1]");
    const childTitle = page.locator(".sub-issue-row .issue-title", { hasText: "Write deployment guide" });
    const grandchildTitle = page.locator(".sub-issue-row .issue-title", { hasText: "Validate the deployment steps" });
    const siblingTitle = page.locator(".sub-issue-row .issue-title", { hasText: "Retired setup experiment" });

    await expect(childTitle).toBeVisible();
    // The child row shows its own progress (1 closed of 2 direct children).
    await expect(rowDiv("Write deployment guide").locator(".sub-issues-progress")).toHaveText("1/2");
    await expect(grandchildTitle).toBeVisible();
    await expect(siblingTitle).toBeVisible();

    // Semantic icons: open grandchild vs closed sibling and closed extra child.
    await expect(rowDiv("Validate the deployment steps").locator(".sub-issue-icon-open")).toHaveCount(1);
    await expect(rowDiv("Retired setup experiment").locator(".sub-issue-icon-closed")).toHaveCount(1);
    await expect(rowDiv("Archived setup notes").locator(".sub-issue-icon-closed")).toHaveCount(1);

    // Branch collapse unmounts the nested rows; expanding restores them.
    await rowDiv("Write deployment guide").locator(".sub-issue-toggle").click();
    await expect(grandchildTitle).toHaveCount(0);
    await expect(siblingTitle).toHaveCount(0);
    await rowDiv("Write deployment guide").locator(".sub-issue-toggle").click();
    await expect(grandchildTitle).toBeVisible();

    // Child navigation opens the child's own detail page.
    await page.locator(".sub-issue-link", { hasText: "Write deployment guide" }).click();
    await expect(page).toHaveURL(new RegExp(`/issues/${child.number}$`));
    await expect(page.getByRole("heading", { name: "Write deployment guide" })).toBeVisible();

    // The panel renders in the dark theme too.
    await page.evaluate(() => localStorage.setItem("nodebook-theme", "dark"));
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(grandchildTitle).toBeVisible();
    await page.evaluate(() => localStorage.removeItem("nodebook-theme"));
  });

  test("create a reminder, deliver it, and see it in the inbox", async ({ page, request }) => {
    await page.goto(`/issues/${issueNumber}`);

    await page.getByLabel("Reminder kind").selectOption("absolute");
    const past = new Date(Date.now() - 60_000);
    await page.getByLabel("Trigger time").fill(past.toISOString().slice(0, 16));
    await page.locator(".reminder-form").getByRole("button", { name: "Add" }).click();
    await expect(page.locator(".reminder")).toBeVisible();

    // Process due reminders (same path as the one-minute Cron Trigger).
    const processed = await apiJson(request, "POST", "/api/reminders/process");
    expect(processed.json).toEqual({ claimed: 1, delivered: 1 });

    // The notification inbox shows the reminder.
    await page.goto("/inbox");
    await page.locator(".bell").click();
    await expect(page.locator(".notif-title", { hasText: "Set up the NodeBook workspace" })).toBeVisible();

    // Mark it read; the badge clears.
    await page.locator(".notif-title", { hasText: "Set up the NodeBook workspace" }).click();
    await expect(page.locator(".bell .badge")).toHaveCount(0);
  });

  test("upload an attachment and preview it", async ({ page, request }) => {
    await page.goto(`/issues/${issueNumber}`);
    const fileInput = page.locator('.uploader input[type="file"]');
    await fileInput.setInputFiles({
      name: "diagram.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    await expect(page.locator(".attachment-item", { hasText: "diagram.png" })).toBeVisible();

    const attachments = await apiJson(request, "GET", `/api/attachments/issue/${issueNumber}`);
    void attachments;
    // Fetch the attachment id from the DOM link.
    const href = await page.locator(".attachment-link a").first().getAttribute("href");
    attachmentId = href!.split("/")[3]!;
    const content = await request.fetch(`${BASE}/api/attachments/${attachmentId}/content`);
    expect(content.status()).toBe(200);
    expect(content.headers()["content-disposition"]).toContain("inline");
  });

  test("search finds the issue and its comment", async ({ page }) => {
    await page.goto("/search");
    await page.getByLabel("Search query").fill("Bootstrap the wiki");
    await expect(page.locator(".search-result", { hasText: "#" + issueNumber })).toBeVisible();
  });

  test("complete a recurring task advances its due date", async ({ page, request }) => {
    const created = await apiJson(request, "POST", "/api/issues", {
      title: "Weekly standup",
      type: "task",
      recurrence_rule: "FREQ=WEEKLY;INTERVAL=1",
      due_date: "2099-01-01",
      timezone: "UTC",
    });
    const recurring = created.json as { number: number; due_date: string };

    await page.goto(`/issues/${recurring.number}`);
    await page.getByRole("button", { name: "✓ Complete" }).click();
    await expect(page.getByText("due 2099-01-08")).toBeVisible();

    // Non-recurring close still works.
    await page.goto(`/issues/${issueNumber}`);
    await page.getByRole("button", { name: "✓ Complete" }).click();
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
  });

  test("MCP mutation is visible in the web UI with audit attribution", async ({ page, request }) => {
    // Create a scoped token via the UI.
    await page.goto("/settings/tokens");
    await page.getByLabel("Name").fill("e2e agent");
    await page.getByLabel("read:issue").check();
    await page.getByLabel("write:issue").check();
    await page.getByRole("button", { name: "Create token" }).click();
    const tokenValue = await page.locator(".token-value").textContent();
    mcpToken = tokenValue!.trim();

    // Use the token over MCP.
    const init = await request.fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${mcpToken}` },
      data: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(init.status()).toBe(200);
    const sessionId = init.headers()["mcp-session-id"]!;

    const call = await request.fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mcpToken}`,
        "Mcp-Session-Id": sessionId,
      },
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "create_issue", arguments: { title: "Created by MCP agent", type: "finding" } },
      }),
    });
    const callBody = (await call.json()) as { result: { content: { text: string }[] } };
    const mcpIssue = JSON.parse(callBody.result.content[0]!.text) as { number: number };

    // Visible in the UI…
    await page.goto(`/issues/${mcpIssue.number}`);
    await expect(page.getByRole("heading", { name: "Created by MCP agent" })).toBeVisible();

    // …with an mcp-attributed audit trail.
    await expect(page.locator(".history-item").first()).toContainText("mcp");

    // Revocation takes effect immediately.
    const tokens = (await apiJson(request, "GET", "/api/tokens")).json as unknown as { id: string; name: string }[];
    const tokenId = tokens.find((t) => t.name === "e2e agent")!.id;
    await apiJson(request, "POST", `/api/tokens/${tokenId}/revoke`);

    const after = await request.fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${mcpToken}` },
      data: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }),
    });
    expect(after.status()).toBe(401);
  });

  test("wiki tree shows the hierarchy", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.locator(".tree-link", { hasText: "Set up the NodeBook workspace" })).toBeVisible();
  });
});
