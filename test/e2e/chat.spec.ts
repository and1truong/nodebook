import { expect, test } from "@playwright/test";

test("chat streams Markdown, sources, and an owner-confirmed proposal", async ({ page }) => {
  const now = new Date().toISOString();
  const connection = { id: "11111111-1111-4111-8111-111111111111", name: "Test provider", provider: "openai", base_url: "https://provider.test/v1", default_model: "test-model", has_api_key: true, tool_support: "supported", created_at: now, updated_at: now };
  const conversation = { id: "22222222-2222-4222-8222-222222222222", title: "New conversation", connection_id: connection.id, connection_name: connection.name, provider: "openai", model: "test-model", folder_id: null, archived: false, generating: false, created_at: now, updated_at: now };
  const proposal = { id: "44444444-4444-4444-8444-444444444444", action_type: "issue.close", payload: { issue_ref: "123" }, review: { operation: "Close #123", before: { status: "open" }, after: { status: "closed" } }, status: "pending", result: null, error_message: null, created_at: now, updated_at: now };
  let messages: Record<string, unknown>[] = [];

  await page.route("**/api/chat/connections", (route) => route.fulfill({ json: [connection] }));
  await page.route("**/api/chat/folders", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/chat/conversations", (route) => route.fulfill({ json: [conversation] }));
  await page.route(`**/api/chat/conversations/${conversation.id}`, (route) => route.fulfill({ json: { conversation, messages } }));
  await page.route(`**/api/chat/conversations/${conversation.id}/messages`, async (route) => {
    const activity = { id: "activity-1", tool_name: "get_issues", label: "Loaded referenced issues · 1 issue", input: { query: "Summarize #123 and close it" }, status: "complete", created_at: now };
    const user = { id: "user-message", conversation_id: conversation.id, role: "user", content: "Summarize #123 and close it", status: "complete", error_message: null, sources: [], activities: [], actions: [], created_at: now, updated_at: now };
    const assistant = { id: "assistant-message", conversation_id: conversation.id, role: "assistant", content: "**Summary** for #123", status: "complete", error_message: null, sources: [{ issue_id: "issue-123", issue_number: 123, title: "Referenced issue", rank: 0 }], activities: [activity], actions: [proposal], created_at: now, updated_at: now };
    messages = [user, assistant];
    const body = [
      { type: "start", user_message_id: user.id, assistant_message_id: assistant.id },
      { type: "activity", activity },
      { type: "delta", delta: "**Summary** for #123" },
      { type: "proposal", proposal },
      { type: "done", message: assistant },
    ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    await route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });
  await page.route(`**/api/chat/actions/${proposal.id}/confirm`, (route) => route.fulfill({ json: { ...proposal, status: "succeeded", result: { number: 123 } } }));

  await page.goto(`/chat/${conversation.id}`);
  await page.getByPlaceholder("Ask about NodeBook or request a change…").fill("Summarize #123 and close it");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Summary", { exact: true })).toBeVisible();
  await expect(page.getByText("Loaded referenced issues · 1 issue", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /#123 Referenced issue/ })).toHaveAttribute("href", "/issues/123");
  await expect(page.getByText("Close #123", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("succeeded", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Summary", { exact: true })).toBeVisible();
});

test("chat folders group, manage, move, drag, and create conversations", async ({ page }) => {
  const now = new Date().toISOString();
  const connection = { id: "11111111-1111-4111-8111-111111111111", name: "Test provider", provider: "openai", base_url: "https://provider.test/v1", default_model: "test-model", has_api_key: true, tool_support: "supported", created_at: now, updated_at: now };
  let folders = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Work", created_at: now, updated_at: now },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Empty", created_at: now, updated_at: now },
  ];
  let conversations = [
    { id: "11111111-2222-4222-8222-222222222222", title: "Recent chat", connection_id: connection.id, connection_name: connection.name, provider: "openai", model: "test-model", folder_id: null, archived: false, generating: false, created_at: now, updated_at: "2026-08-18T03:00:00.000Z" },
    { id: "22222222-2222-4222-8222-222222222222", title: "Work chat", connection_id: connection.id, connection_name: connection.name, provider: "openai", model: "test-model", folder_id: folders[0]!.id, archived: false, generating: false, created_at: now, updated_at: "2026-08-18T02:00:00.000Z" },
    { id: "33333333-2222-4222-8222-222222222222", title: "Archived chat", connection_id: connection.id, connection_name: connection.name, provider: "openai", model: "test-model", folder_id: folders[0]!.id, archived: true, generating: false, created_at: now, updated_at: "2026-08-18T04:00:00.000Z" },
  ];
  let createdInFolder: string | null | undefined;

  await page.route("**/api/chat/connections", (route) => route.fulfill({ json: [connection] }));
  await page.route("**/api/chat/folders", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON() as { name: string };
      const folder = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: input.name, created_at: now, updated_at: now };
      folders = [...folders, folder];
      await route.fulfill({ status: 201, json: folder });
      return;
    }
    await route.fulfill({ json: [...folders].sort((a, b) => a.name.localeCompare(b.name)) });
  });
  await page.route("**/api/chat/folders/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    if (route.request().method() === "PATCH") {
      const input = route.request().postDataJSON() as { name: string };
      folders = folders.map((folder) => folder.id === id ? { ...folder, name: input.name, updated_at: now } : folder);
      await route.fulfill({ json: folders.find((folder) => folder.id === id)! });
      return;
    }
    folders = folders.filter((folder) => folder.id !== id);
    conversations = conversations.map((conversation) => conversation.folder_id === id ? { ...conversation, folder_id: null } : conversation);
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/chat/conversations", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON() as { connection_id: string; model: string; folder_id?: string | null };
      createdInFolder = input.folder_id;
      const conversation = { id: "44444444-2222-4222-8222-222222222222", title: "New conversation", connection_id: connection.id, connection_name: connection.name, provider: "openai", model: input.model, folder_id: input.folder_id ?? null, archived: false, generating: false, created_at: now, updated_at: now };
      conversations = [conversation, ...conversations];
      await route.fulfill({ status: 201, json: conversation });
      return;
    }
    await route.fulfill({ json: conversations });
  });
  await page.route("**/api/chat/conversations/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    const conversation = conversations.find((item) => item.id === id)!;
    if (route.request().method() === "PATCH") {
      const input = route.request().postDataJSON() as { folder_id?: string | null };
      conversations = conversations.map((item) => item.id === id ? { ...item, ...input, updated_at: now } : item);
      await route.fulfill({ json: conversations.find((item) => item.id === id)! });
      return;
    }
    await route.fulfill({ json: { conversation, messages: [] } });
  });

  await page.goto("/chat");
  const workFolder = page.locator(".chat-folder").filter({ hasText: "Work" });
  await expect(page.getByText("Recents", { exact: true })).toBeVisible();
  await expect(page.locator(".chat-folder").filter({ hasText: "Empty" }).getByText("No conversations")).toBeVisible();
  await expect(workFolder.locator(".chat-conversation")).toHaveText([/Work chat/, /Archived chat.*archived/]);

  await page.getByRole("button", { name: /Work 2/ }).click();
  await expect(page.getByText("Work chat", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: /Work 2/ }).click();
  await expect(page.getByText("Work chat", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Move Recent chat" }).click();
  await page.getByRole("menuitem", { name: "Work" }).click();
  await expect(workFolder.getByText("Recent chat", { exact: true })).toBeVisible();

  const dragHandle = page.getByRole("button", { name: "Drag Work chat" });
  const emptyTarget = page.getByRole("button", { name: /Empty 0/ });
  const [from, to] = await Promise.all([dragHandle.boundingBox(), emptyTarget.boundingBox()]);
  if (!from || !to) throw new Error("Drag elements were not laid out");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".chat-folder").filter({ hasText: "Empty" }).getByText("Work chat", { exact: true })).toBeVisible();

  const movedHandle = page.getByRole("button", { name: "Drag Work chat" });
  const recentsTarget = page.getByRole("button", { name: /Recents 0/ });
  const [movedFrom, recentsTo] = await Promise.all([movedHandle.boundingBox(), recentsTarget.boundingBox()]);
  if (!movedFrom || !recentsTo) throw new Error("Recents drag elements were not laid out");
  await page.mouse.move(movedFrom.x + movedFrom.width / 2, movedFrom.y + movedFrom.height / 2);
  await page.mouse.down();
  await page.mouse.move(recentsTo.x + recentsTo.width / 2, recentsTo.y + recentsTo.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".chat-folder").filter({ hasText: "Recents" }).getByText("Work chat", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create folder" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Personal");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Personal", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage Personal" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Home");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Home", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Manage Home" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText("Home", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "New chat" }).click();
  const newChatDialog = page.getByRole("dialog", { name: "New conversation" });
  await newChatDialog.locator('[data-slot="select-trigger"]').nth(0).click();
  await page.getByRole("option", { name: "Test provider" }).click();
  await newChatDialog.locator('[data-slot="select-trigger"]').nth(1).click();
  await page.getByRole("option", { name: "Work" }).click();
  await newChatDialog.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => createdInFolder).toBe(folders.find((folder) => folder.name === "Work")!.id);
});
