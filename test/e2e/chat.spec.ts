import { expect, test } from "@playwright/test";

test("chat streams Markdown, sources, and an owner-confirmed proposal", async ({ page }) => {
  const now = new Date().toISOString();
  const connection = { id: "11111111-1111-4111-8111-111111111111", name: "Test provider", provider: "openai", base_url: "https://provider.test/v1", default_model: "test-model", has_api_key: true, tool_support: "supported", created_at: now, updated_at: now };
  const conversation = { id: "22222222-2222-4222-8222-222222222222", title: "New conversation", connection_id: connection.id, connection_name: connection.name, provider: "openai", model: "test-model", archived: false, generating: false, created_at: now, updated_at: now };
  const proposal = { id: "44444444-4444-4444-8444-444444444444", action_type: "issue.close", payload: { issue_ref: "123" }, review: { operation: "Close #123", before: { status: "open" }, after: { status: "closed" } }, status: "pending", result: null, error_message: null, created_at: now, updated_at: now };
  let messages: Record<string, unknown>[] = [];

  await page.route("**/api/chat/connections", (route) => route.fulfill({ json: [connection] }));
  await page.route("**/api/chat/conversations", (route) => route.fulfill({ json: [conversation] }));
  await page.route(`**/api/chat/conversations/${conversation.id}`, (route) => route.fulfill({ json: { conversation, messages } }));
  await page.route(`**/api/chat/conversations/${conversation.id}/messages`, async (route) => {
    const user = { id: "user-message", conversation_id: conversation.id, role: "user", content: "Summarize #123 and close it", status: "complete", error_message: null, sources: [], actions: [], created_at: now, updated_at: now };
    const assistant = { id: "assistant-message", conversation_id: conversation.id, role: "assistant", content: "**Summary** for #123", status: "complete", error_message: null, sources: [{ issue_id: "issue-123", issue_number: 123, title: "Referenced issue", rank: 0 }], actions: [proposal], created_at: now, updated_at: now };
    messages = [user, assistant];
    const body = [
      { type: "start", user_message_id: user.id, assistant_message_id: assistant.id },
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
  await expect(page.getByRole("link", { name: /#123 Referenced issue/ })).toHaveAttribute("href", "/issues/123");
  await expect(page.getByText("Close #123", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("succeeded", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Summary", { exact: true })).toBeVisible();
});
