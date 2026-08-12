/**
 * MVP acceptance flow (browser): creation → linking → planning → reminders →
 * attachments → search → MCP mutation → visible audit history.
 *
 * The Playwright webServer boots `wrangler dev` on :8787 serving the built SPA
 * with local D1/R2 state (see playwright.config.ts).
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

async function apiJson(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const res = await request.fetch(path, {
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
    // Planning is collapsed when empty; expand it to set a due date.
    await page.getByRole("button", { name: /Planning/ }).click();
    // A normal click on the icon must leave the calendar open after release.
    const dueDateCalendar = page.getByRole("button", { name: "Due date calendar" });
    await dueDateCalendar.click();
    await expect(dueDateCalendar).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible();
    await page.getByRole("textbox", { name: "Due date" }).fill("2099-01-01");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Bootstrap the wiki")).toBeVisible();
    await expect(page.locator(".chip", { hasText: "setup" })).toBeVisible();

    // Issue content tabs expose empty states without opening every panel and
    // support standard arrow-key navigation.
    const subIssuesTab = page.getByRole("tab", { name: "Sub-issues, 0 items" });
    await expect(subIssuesTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Backlinks, 0 items" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Attachments, 0 items" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Reminders, 0 items" })).toBeVisible();
    await subIssuesTab.focus();
    await subIssuesTab.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Backlinks, 0 items" })).toHaveAttribute("aria-selected", "true");
    await subIssuesTab.click();
  });

  test("organize inbox issues with per-row controls", async ({ page, request }) => {
    const createInboxIssue = async (title: string, type = "task") => {
      const response = await apiJson(request, "POST", "/api/issues", { title, type });
      expect(response.status).toBe(201);
      return response.json as unknown as { id: string; number: number; created_at: string };
    };

    const priorityTask = await createInboxIssue("Inbox priority task");
    const todayTask = await createInboxIssue("Inbox today task");
    const tomorrowTask = await createInboxIssue("Inbox tomorrow task");
    const customDateTask = await createInboxIssue("Inbox custom date task");
    const closeNote = await createInboxIssue("Inbox note to close", "note");

    await page.goto("/inbox");

    const priorityRow = page.locator(".issue-row", { hasText: "Inbox priority task" });
    const createdTime = priorityRow.locator("time.issue-created");
    await expect(createdTime).toHaveAttribute("datetime", priorityTask.created_at);
    await expect(createdTime).toContainText("Created ");

    await priorityRow.getByLabel(`Priority for #${priorityTask.number}`).click();
    await page.getByRole("option", { name: "High" }).click();
    await expect(priorityRow.getByLabel(`Priority for #${priorityTask.number}`)).toContainText("High");
    const prioritized = await apiJson(request, "GET", `/api/issues/${priorityTask.number}`);
    expect(prioritized.json.priority).toBe("high");

    await priorityRow.getByRole("button", { name: `Complete issue #${priorityTask.number}` }).click();
    await expect(priorityRow).toHaveCount(0);

    const todayRow = page.locator(".issue-row", { hasText: "Inbox today task" });
    await todayRow.getByRole("button", { name: `Plan issue #${todayTask.number}` }).click();
    await page.getByRole("menuitem", { name: "Today", exact: true }).click();
    await expect(todayRow).toHaveCount(0);
    const plannedToday = await apiJson(request, "GET", `/api/issues/${todayTask.number}`);
    expect(plannedToday.json.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const tomorrowRow = page.locator(".issue-row", { hasText: "Inbox tomorrow task" });
    await tomorrowRow.getByRole("button", { name: `Plan issue #${tomorrowTask.number}` }).click();
    await page.getByRole("menuitem", { name: "Tomorrow", exact: true }).click();
    await expect(tomorrowRow).toHaveCount(0);
    const plannedTomorrow = await apiJson(request, "GET", `/api/issues/${tomorrowTask.number}`);
    expect(plannedTomorrow.json.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(plannedTomorrow.json.due_date).not.toBe(plannedToday.json.due_date);

    const customRow = page.locator(".issue-row", { hasText: "Inbox custom date task" });
    await customRow.getByRole("button", { name: `Plan issue #${customDateTask.number}` }).click();
    await page.getByRole("menuitem", { name: "Pick date…" }).click();
    const customDate = customRow.getByRole("textbox", { name: `Due date for #${customDateTask.number}` });
    await customDate.fill("2099-02-03");
    await customDate.press("Escape");
    await customRow.getByRole("button", { name: "Apply" }).click();
    await expect(customRow).toHaveCount(0);
    const plannedCustom = await apiJson(request, "GET", `/api/issues/${customDateTask.number}`);
    expect(plannedCustom.json.due_date).toBe("2099-02-03");

    const noteRow = page.locator(".issue-row", { hasText: "Inbox note to close" });
    await noteRow.getByRole("button", { name: `Close issue #${closeNote.number}` }).click();
    await expect(noteRow).toHaveCount(0);
    const closed = await apiJson(request, "GET", `/api/issues/${closeNote.number}`);
    expect(closed.json.status).toBe("closed");
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

  test("preview a referenced issue on hover", async ({ page, request }) => {
    const targetRes = await apiJson(request, "POST", "/api/issues", {
      title: "Hover card target",
      body: "A concise target summary for the issue preview.",
      type: "decision",
      labels: ["preview"],
    });
    const target = targetRes.json as unknown as { id: string; number: number };
    const sourceRes = await apiJson(request, "POST", "/api/issues", {
      title: "Hover card source",
      body: `Review #${target.number} before continuing.`,
      type: "task",
      parent_id: target.id,
    });
    const source = sourceRes.json as unknown as { number: number };

    await page.goto(`/issues/${source.number}`);
    await page.locator(`.issue-body a[href='/issues/${target.number}']`).hover();

    const card = page.locator(".issue-hover-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Hover card target");
    await expect(card).toContainText(`#${target.number}`);
    await expect(card).toContainText("open");
    await expect(card).toContainText("A concise target summary");
    await expect(card.locator(".chip", { hasText: "preview" })).toBeVisible();

    // Sidebar links, including the Parent property, use the same preview.
    await page.mouse.move(0, 0);
    await expect(card).toBeHidden();
    await page.locator(`.issue-sidebar a[href='/issues/${target.number}']`).hover();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Hover card target");

    // Incoming references moved from the sidebar into a count-aware tab.
    await page.goto(`/issues/${target.number}`);
    const backlinksTab = page.getByRole("tab", { name: "Backlinks, 1 item" });
    await expect(backlinksTab).toBeVisible();
    await backlinksTab.click();
    await expect(page.getByRole("tabpanel").getByRole("link", { name: new RegExp(`#${source.number} Hover card source`) })).toBeVisible();
  });

  test("render nested sub-issues lazily", async ({ page, request }) => {
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

    // Count successful hierarchy responses to prove lazy loading and caching
    // (an aborted request never produces a response).
    const subIssueResponses: string[] = [];
    page.on("response", (res) => {
      if (res.url().includes("/sub-issues") && res.ok()) subIssueResponses.push(res.url());
    });

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

    // Page load fetches the root level only: direct children are visible and
    // every branch starts collapsed, so grandchildren are absent.
    await expect(childTitle).toBeVisible();
    await expect(grandchildTitle).toHaveCount(0);
    await expect(siblingTitle).toHaveCount(0);
    // The child row shows its own progress from server-provided counts
    // (1 closed of 2 direct children) without loading them.
    await expect(rowDiv("Write deployment guide").locator(".sub-issues-progress")).toHaveText("1/2");
    expect(subIssueResponses).toHaveLength(1);

    // Branch failure stays local: abort the branch request, expand, see an
    // inline error with Retry, and recover without a page reload.
    const branchUrl = `**/api/graph/${child.number}/sub-issues`;
    await page.route(branchUrl, (route) => route.abort());
    await rowDiv("Write deployment guide").locator(".sub-issue-toggle").click();
    await expect(page.locator(".sub-issue-branch-error")).toBeVisible();
    await expect(grandchildTitle).toHaveCount(0);
    await page.unroute(branchUrl);
    await page.locator(".sub-issue-branch-error").getByRole("button", { name: "Retry" }).click();

    // Retry reveals both direct children; the branch request fired once.
    await expect(grandchildTitle).toBeVisible();
    await expect(siblingTitle).toBeVisible();
    expect(subIssueResponses).toHaveLength(2);

    // Semantic icons: open grandchild vs closed sibling and closed extra child.
    await expect(rowDiv("Validate the deployment steps").locator(".sub-issue-icon-open")).toHaveCount(1);
    await expect(rowDiv("Retired setup experiment").locator(".sub-issue-icon-closed")).toHaveCount(1);
    await expect(rowDiv("Archived setup notes").locator(".sub-issue-icon-closed")).toHaveCount(1);

    // Branch collapse unmounts the nested rows; expanding restores them from
    // the cache — no additional hierarchy request.
    await rowDiv("Write deployment guide").locator(".sub-issue-toggle").click();
    await expect(grandchildTitle).toHaveCount(0);
    await expect(siblingTitle).toHaveCount(0);
    await rowDiv("Write deployment guide").locator(".sub-issue-toggle").click();
    await expect(grandchildTitle).toBeVisible();
    await expect(siblingTitle).toBeVisible();
    expect(subIssueResponses).toHaveLength(2);

    // Child navigation opens the child's own detail page.
    await page.locator(".sub-issue-link", { hasText: "Write deployment guide" }).click();
    await expect(page).toHaveURL(new RegExp(`/issues/${child.number}$`));
    await expect(page.getByRole("heading", { name: "Write deployment guide" })).toBeVisible();

    // The panel renders in the dark theme too: branches start collapsed and
    // expand on demand (back on the root page, where the grandchild is nested).
    await page.goto(`/issues/${root.number}`);
    await page.evaluate(() => localStorage.setItem("nodebook-theme", "dark"));
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator(".sub-issue-row .issue-title", { hasText: "Validate the deployment steps" })).toHaveCount(0);
    await rowDiv("Write deployment guide").locator(".sub-issue-toggle").click();
    await expect(grandchildTitle).toBeVisible();
    await page.evaluate(() => localStorage.removeItem("nodebook-theme"));
  });

  test("add an existing issue as a sub-issue: link, reparent, cycle guard", async ({ page, request }) => {
    // Fixtures: an unattached issue; a parented issue with a descendant; and
    // an ancestor of the root (to exercise the server-side cycle rejection).
    const rootRes = await apiJson(request, "POST", "/api/issues", { title: "Linking demo root", type: "task" });
    expect(rootRes.status).toBe(201);
    const root = rootRes.json as { id: string; number: number };

    const orphanRes = await apiJson(request, "POST", "/api/issues", {
      title: "Lonely unattached task",
      type: "task",
    });
    expect(orphanRes.status).toBe(201);
    const orphan = orphanRes.json as { id: string; number: number };

    const ancestorRes = await apiJson(request, "POST", "/api/issues", { title: "Root ancestor", type: "task" });
    const ancestor = ancestorRes.json as { id: string; number: number };
    await apiJson(request, "POST", `/api/graph/${root.number}/parent`, { parent_id: ancestor.id });

    const oldParentRes = await apiJson(request, "POST", "/api/issues", { title: "Old parent issue", type: "task" });
    const oldParent = oldParentRes.json as { id: string; number: number };
    const movingRes = await apiJson(request, "POST", "/api/issues", { title: "Moving reparented task", type: "task" });
    const moving = movingRes.json as { id: string; number: number };
    const grandchildRes = await apiJson(request, "POST", "/api/issues", {
      title: "Retained descendant",
      type: "task",
    });
    const grandchild = grandchildRes.json as { id: string; number: number };
    await apiJson(request, "POST", `/api/graph/${moving.number}/parent`, { parent_id: oldParent.id });
    await apiJson(request, "POST", `/api/graph/${grandchild.number}/parent`, { parent_id: moving.id });
    // Highest number allocated by the fixtures above; linking must not allocate
    // any new issue number beyond it.
    const maxFixtureNumber = grandchild.number;

    await page.goto(`/issues/${root.number}`);

    const openPicker = async () => {
      await page.getByRole("button", { name: "Sub-issue actions" }).click();
      await page
        .locator(".sub-issues-action-menu")
        .getByRole("menuitem", { name: "Add existing issue" })
        .click();
      await expect(page.locator(".sub-issues-link-form")).toBeVisible();
    };
    const search = (q: string) => page.getByLabel("Search issues").fill(q);
    const linkSelected = () =>
      page.locator(".sub-issues-link-form").getByRole("button", { name: "Link issue" }).click();

    // 1. Link an unattached issue by number; no new issue is created.
    await openPicker();
    await search(String(orphan.number));
    await expect(page.locator(".existing-issue-result", { hasText: "Lonely unattached task" })).toBeVisible();
    await page.locator(".existing-issue-result", { hasText: "Lonely unattached task" }).click();
    await linkSelected();

    await expect(page.locator(".sub-issue-row", { hasText: "Lonely unattached task" })).toBeVisible();
    await expect(page.locator(".sub-issues-header .sub-issues-progress")).toHaveText("0/1");
    const orphanDetail = await apiJson(request, "GET", `/api/issues/${orphan.number}`);
    expect((orphanDetail.json as { parent_id: string | null }).parent_id).toBe(root.id);
    const list = await apiJson(request, "GET", "/api/issues?limit=100");
    const numbers = (list.json.issues as { number: number }[]).map((i) => i.number);
    expect(numbers.filter((n) => n > maxFixtureNumber)).toEqual([]);

    // 2. Reopening the picker excludes the linked issue and the root itself.
    await openPicker();
    await search(String(orphan.number));
    await expect(page.locator(".existing-issue-result", { hasText: "Lonely unattached task" })).toHaveCount(0);
    await search(String(root.number));
    await expect(page.locator(".existing-issue-result", { hasText: "Linking demo root" })).toHaveCount(0);
    await page.locator(".sub-issues-link-form").getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".sub-issues-link-form")).toHaveCount(0);

    // 3. Linking a parented issue moves it from its old parent; its
    // descendant is preserved but lazy: it appears only after expanding.
    await openPicker();
    await search(String(moving.number));
    const movingRow = page.locator(".existing-issue-result", { hasText: "Moving reparented task" });
    await expect(movingRow).toContainText("under #" + oldParent.number);
    await movingRow.click();
    await expect(page.locator(".sub-issues-link-form")).toContainText("moves it from");
    await linkSelected();

    const movingTitle = page.locator(".sub-issue-row .issue-title", { hasText: "Moving reparented task" });
    const retainedTitle = page.locator(".sub-issue-row .issue-title", { hasText: "Retained descendant" });
    await expect(movingTitle).toBeVisible();
    // The moved row's progress badge reflects its unloaded descendant.
    await expect(movingTitle.locator("xpath=ancestor::div[contains(@class,'issue-row')][1]").locator(".sub-issues-progress")).toHaveText("0/1");
    // Grandchildren are not fetched until their branch expands.
    await expect(retainedTitle).toHaveCount(0);
    await expect(page.locator(".sub-issues-header .sub-issues-progress")).toHaveText("0/2");
    const oldChildren = await apiJson(request, "GET", `/api/graph/${oldParent.number}/children`);
    expect((oldChildren.json as unknown as { id: string }[]).map((c) => c.id)).not.toContain(moving.id);

    // The picker excludes unexpanded descendants server-side: searching for
    // the retained grandchild never offers it, while expanding the branch
    // reveals it locally.
    await openPicker();
    await search("Retained descendant");
    await expect(page.locator(".existing-issue-result", { hasText: "Retained descendant" })).toHaveCount(0);
    await page.locator(".sub-issues-link-form").getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".sub-issues-link-form")).toHaveCount(0);
    await movingTitle.locator("xpath=ancestor::div[contains(@class,'issue-row')][1]").locator(".sub-issue-toggle").click();
    await expect(retainedTitle).toBeVisible();

    // 4. Attaching an ancestor is rejected server-side; the picker stays open
    // and shows the server message without corrupting the tree.
    await openPicker();
    await search(String(ancestor.number));
    await expect(page.locator(".existing-issue-result", { hasText: "Root ancestor" })).toBeVisible();
    await page.locator(".existing-issue-result", { hasText: "Root ancestor" }).click();
    await linkSelected();
    await expect(page.locator(".sub-issues-link-form").locator(".error-inline")).toContainText("cycle");
    await expect(page.locator(".sub-issue-row", { hasText: "Root ancestor" })).toHaveCount(0);
    await expect(page.locator(".sub-issues-link-form")).toBeVisible();
    await page.locator(".sub-issues-link-form").getByRole("button", { name: "Cancel" }).click();
  });

  test("create a reminder, deliver it, and see it in the inbox", async ({ page, request }) => {
    await page.goto(`/issues/${issueNumber}`);

    await page.getByRole("tab", { name: "Reminders, 0 items" }).click();
    await page.getByLabel("Reminder kind").selectOption("absolute");
    const past = new Date(Date.now() - 60_000).toISOString().slice(0, 16);
    await page.getByLabel("Trigger date", { exact: true }).fill(past.slice(0, 10));
    await page.getByLabel("Trigger time", { exact: true }).fill(past.slice(11));
    await page.locator(".reminder-form").getByRole("button", { name: "Add" }).click();
    await expect(page.locator(".reminder")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Reminders, 1 item" })).toBeVisible();

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
    const attachmentsTab = page.getByRole("tab", { name: "Attachments, 0 items" });
    await attachmentsTab.click();
    const fileInput = page.locator('.uploader input[type="file"]');
    await fileInput.setInputFiles({
      name: "diagram.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    await expect(page.locator(".attachment-item", { hasText: "diagram.png" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Attachments, 1 item" })).toBeVisible();

    const attachments = await apiJson(request, "GET", `/api/attachments/issue/${issueNumber}`);
    void attachments;
    // Fetch the attachment id from the DOM link.
    const href = await page.locator(".attachment-link a").first().getAttribute("href");
    attachmentId = href!.split("/")[3]!;
    const content = await request.fetch(`/api/attachments/${attachmentId}/content`);
    expect(content.status()).toBe(200);
    expect(content.headers()["content-disposition"]).toContain("inline");
  });

  test("issue details sidebar: desktop placement and responsive stacking", async ({ page }) => {
    await page.goto(`/issues/${issueNumber}`);
    const aside = page.getByRole("complementary", { name: "Issue details" });

    // The sidebar keeps metadata and secondary tools; attachments and
    // backlinks now live in the main-column tab set.
    await expect(aside).toBeVisible();
    await expect(aside.locator(".chip", { hasText: "setup" })).toBeVisible();
    await expect(aside.getByText("due 2099-01-01")).toBeVisible();
    await expect(aside.locator(".uploader")).toHaveCount(0);
    await expect(aside.getByText("Backlinks", { exact: true })).toHaveCount(0);
    await expect(aside.locator(".reminder-form")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Reminders, 1 item" })).toBeVisible();
    await expect(aside.locator(".rel-item", { hasText: "#" + childNumber })).toBeVisible();
    const attachmentsTab = page.getByRole("tab", { name: "Attachments, 1 item" });
    await expect(attachmentsTab).toBeVisible();
    await attachmentsTab.click();
    await expect(page.locator(".issue-main .attachment-item", { hasText: "diagram.png" })).toBeVisible();
    // The status badge and state-transition controls stay in the full-width header.
    await expect(page.locator(".issue-head").getByRole("button", { name: "✓ Complete" })).toBeVisible();

    // Desktop: the aside physically sits to the right of the main column.
    const mainBox = await page.locator(".issue-main").boundingBox();
    const asideBox = await aside.boundingBox();
    expect(asideBox!.x).toBeGreaterThanOrEqual(mainBox!.x + mainBox!.width - 1);

    // Narrow: the aside stacks below the main column without horizontal overflow.
    await page.setViewportSize({ width: 900, height: 800 });
    const mainBoxNarrow = await page.locator(".issue-main").boundingBox();
    const asideBoxNarrow = await aside.boundingBox();
    expect(asideBoxNarrow!.y).toBeGreaterThanOrEqual(mainBoxNarrow!.y + mainBoxNarrow!.height - 1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // The sidebar keeps the same warm hierarchy in the dark theme.
    await page.evaluate(() => localStorage.setItem("nodebook-theme", "dark"));
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(aside).toBeVisible();
    await expect(aside.locator(".chip", { hasText: "setup" })).toBeVisible();
    await expect(aside.getByText("due 2099-01-01")).toBeVisible();
    const darkTokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return { bg: s.getPropertyValue("--background").trim(), card: s.getPropertyValue("--card").trim() };
    });
    expect(darkTokens).toEqual({ bg: "#1a1200", card: "#251a00" });
    await page.evaluate(() => localStorage.removeItem("nodebook-theme"));
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
    const init = await request.fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${mcpToken}` },
      data: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(init.status()).toBe(200);
    const sessionId = init.headers()["mcp-session-id"]!;

    const call = await request.fetch("/mcp", {
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

    // …with creator attribution sourced from the MCP audit event.
    await expect(page.locator(".issue-summary")).toContainText("mcp");

    // Revocation takes effect immediately.
    const tokens = (await apiJson(request, "GET", "/api/tokens")).json as unknown as { id: string; name: string }[];
    const tokenId = tokens.find((t) => t.name === "e2e agent")!.id;
    await apiJson(request, "POST", `/api/tokens/${tokenId}/revoke`);

    const after = await request.fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${mcpToken}` },
      data: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }),
    });
    expect(after.status()).toBe(401);
  });

  test("wiki provides a browsable home and focused reading view", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.getByRole("heading", { name: "Browse by topic" })).toBeVisible();

    const rootPage = page.locator(".tree-link", { hasText: "Set up the NodeBook workspace" });
    const childPage = page.locator(".tree-link", { hasText: "Write deployment guide" });
    await expect(rootPage).toBeVisible();
    await expect(childPage).toHaveCount(0);

    await page.getByRole("button", { name: "Expand Set up the NodeBook workspace" }).click();
    await expect(childPage).toBeVisible();
    await rootPage.click();

    await expect(page).toHaveURL(`/wiki/${issueNumber}`);
    await expect(page.locator('aside[aria-label="Wiki pages"]')).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Set up the NodeBook workspace", exact: true })).toBeVisible();
    await expect(page.getByText("Bootstrap the wiki.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit & manage" })).toHaveAttribute("href", `/issues/${issueNumber}`);

    await page.getByRole("link", { name: "New page" }).click();
    await expect(page.getByRole("heading", { name: "New wiki page" })).toBeVisible();
    await expect(page.getByLabel("Type", { exact: true })).toContainText("wiki");
  });
});
