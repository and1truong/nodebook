/** MCP: protocol tests, one test per tool family, scopes, parity with HTTP. */
import { describe, expect, it } from "vitest";
import { api, createIssue, createMcpToken, mcpCall, mcpInitialize, post } from "./helpers";

async function callTool(
  token: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const res = await mcpCall(token, "tools/call", { name, arguments: args }, sessionId);
  if (res.body.error) return { error: res.body.error as { code: number; message: string } };
  const content = (res.body.result as { content: { text: string }[] }).content[0]!.text;
  return { result: JSON.parse(content) as unknown };
}

async function setupToken(scopes: string[]): Promise<{ token: string; sessionId: string }> {
  const { token } = await createMcpToken(scopes);
  const { sessionId } = await mcpInitialize(token);
  return { token, sessionId };
}

describe("MCP tools", () => {
  it("get_issue and search_issues (read)", async () => {
    const issue = await createIssue({ title: "mcp readable", body: "mcp-token-body-123" });
    const { token, sessionId } = await setupToken(["read:issue", "read:search"]);

    const got = await callTool(token, sessionId, "get_issue", { number: issue.number });
    expect((got.result as { title: string }).title).toBe("mcp readable");

    const searched = await callTool(token, sessionId, "search_issues", { query: "mcp-token-body-123" });
    expect((searched.result as { count: number }).count).toBeGreaterThanOrEqual(1);
  });

  it("get_children, get_backlinks (read graph)", async () => {
    const parent = await createIssue({ title: "mcp parent" });
    const child = await createIssue({ title: "mcp child", body: `child of #${parent.number}` });
    await post(`/api/graph/${child.number}/parent`, { parent_id: parent.id });

    const { token, sessionId } = await setupToken(["read:graph"]);
    const children = await callTool(token, sessionId, "get_children", { issue_id: parent.number });
    expect((children.result as { number: number }[]).map((c) => c.number)).toContain(child.number);

    const backlinks = await callTool(token, sessionId, "get_backlinks", { issue_id: parent.number });
    expect((backlinks.result as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("search_knowledge, get_today, get_upcoming (read planning/search)", async () => {
    await createIssue({ title: "mcp knowledge item", type: "decision" });
    const { token, sessionId } = await setupToken(["read:search", "read:planning"]);

    const knowledge = await callTool(token, sessionId, "search_knowledge", { query: "mcp knowledge item" });
    const results = (knowledge.result as { results: { issue_type: string }[] }).results;
    expect(results[0]!.issue_type).toBe("decision");

    const today = await callTool(token, sessionId, "get_today", { timezone: "UTC" });
    expect(Array.isArray(today.result)).toBe(true);

    const upcoming = await callTool(token, sessionId, "get_upcoming", { timezone: "UTC" });
    expect(Array.isArray(upcoming.result)).toBe(true);
  });

  it("create_issue, update_issue, close_issue, complete_task (write issue)", async () => {
    const { token, sessionId } = await setupToken(["write:issue"]);

    const created = await callTool(token, sessionId, "create_issue", { title: "mcp created", type: "task" });
    const issue = created.result as { id: string; number: number; status: string };
    expect(issue.status).toBe("open");

    const updated = await callTool(token, sessionId, "update_issue", { issue_id: issue.id, priority: "high" });
    expect((updated.result as { priority: string }).priority).toBe("high");

    const closed = await callTool(token, sessionId, "close_issue", { issue_id: issue.id });
    expect((closed.result as { status: string }).status).toBe("closed");

    // Non-recurring complete_task on an open issue closes it.
    const fresh = await callTool(token, sessionId, "create_issue", { title: "mcp complete" });
    const freshIssue = fresh.result as { id: string };
    const completed = await callTool(token, sessionId, "complete_task", { issue_id: freshIssue.id });
    expect((completed.result as { status: string }).status).toBe("closed");
  });

  it("add_comment, add_child, link_issues (write comment/graph)", async () => {
    const parent = await createIssue({ title: "mcp tree root" });
    const { token, sessionId } = await setupToken(["write:comment", "write:graph"]);

    const child = await callTool(token, sessionId, "add_child", {
      parent_id: parent.id,
      title: "mcp child",
    });
    const childIssue = child.result as { id: string; number: number; parent_number: number | null };
    expect(childIssue.parent_number).toBe(parent.number);

    const comment = await callTool(token, sessionId, "add_comment", {
      issue_id: childIssue.id,
      body: "from mcp",
    });
    expect((comment.result as { body: string }).body).toBe("from mcp");

    const link = await callTool(token, sessionId, "link_issues", {
      source_id: parent.id,
      target_id: childIssue.id,
      type: "depends_on",
    });
    expect((link.result as { type: string }).type).toBe("depends_on");
  });

  it("create_reminder, update_reminder (write reminder)", async () => {
    const issue = await createIssue({ title: "mcp remind", due_date: "2031-01-01" });
    const { token, sessionId } = await setupToken(["write:reminder"]);

    const created = await callTool(token, sessionId, "create_reminder", {
      issue_id: issue.id,
      kind: "absolute",
      trigger_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const reminder = created.result as { id: string; status: string };
    expect(reminder.status).toBe("active");

    const dismissed = await callTool(token, sessionId, "update_reminder", {
      reminder_id: reminder.id,
      status: "dismissed",
    });
    expect((dismissed.result as { status: string }).status).toBe("dismissed");
  });

  it("list_attachments and attach_file (read/write attachment)", async () => {
    const issue = await createIssue({ title: "mcp files" });
    const { token, sessionId } = await setupToken(["read:attachment", "write:attachment"]);

    const data = btoa("mcp attachment bytes");
    const attached = await callTool(token, sessionId, "attach_file", {
      issue_id: issue.id,
      filename: "from-mcp.txt",
      content_type: "text/plain",
      data,
    });
    const attachment = attached.result as { id: string; filename: string; size: number };
    expect(attachment.filename).toBe("from-mcp.txt");
    expect(attachment.size).toBe(20); // "mcp attachment bytes" is 20 bytes

    const list = await callTool(token, sessionId, "list_attachments", { issue_id: issue.number });
    expect((list.result as { filename: string }[]).map((a) => a.filename)).toContain("from-mcp.txt");
  });

  it("rejects attach_file above the MCP size limit", async () => {
    const issue = await createIssue({ title: "mcp big file" });
    const { token, sessionId } = await setupToken(["write:attachment"]);
    const big = btoa("x".repeat(5 * 1024 * 1024 + 1024));
    const res = await callTool(token, sessionId, "attach_file", {
      issue_id: issue.id,
      filename: "big.bin",
      data: big,
    });
    expect(res.error).toBeTruthy();
    expect(res.error!.message).toContain("limit");
  });

  it("produces equivalent audit events to HTTP mutations", async () => {
    const { token, sessionId } = await setupToken(["write:issue"]);
    const res = await callTool(token, sessionId, "create_issue", {
      title: "parity issue",
      body: "parity body",
      labels: ["parity"],
    });
    const issue = res.result as { number: number };

    const history = (await api(`/api/issues/${issue.number}/history`)).body as {
      actor_type: string;
      action: string;
      after: { labels: string[] } | null;
    }[];
    const create = history.find((e) => e.action === "issue.create")!;
    expect(create.actor_type).toBe("mcp");
    expect(create.after?.labels).toEqual(["parity"]);
  });

  it("rejects invalid reminder dates as invalid params (-32602)", async () => {
    const issue = await createIssue({ title: "bad date reminder" });
    const { token, sessionId } = await setupToken(["write:reminder"]);
    const res = await callTool(token, sessionId, "create_reminder", {
      issue_id: issue.id,
      kind: "absolute",
      trigger_at: "not-a-date",
    });
    expect(res.error).toBeTruthy();
    expect(res.error!.code).toBe(-32602);
  });

  it("requires write:graph when create_issue/update_issue set parent_id", async () => {
    const parent = await createIssue({ title: "scope parent" });
    const { token, sessionId } = await setupToken(["write:issue"]);

    const create = await callTool(token, sessionId, "create_issue", {
      title: "scope child",
      parent_id: parent.id,
    });
    expect(create.error).toBeTruthy();
    expect(create.error!.code).toBe(-32003);

    const child = await createIssue({ title: "scope child" });
    const update = await callTool(token, sessionId, "update_issue", {
      issue_id: child.id,
      parent_id: parent.id,
    });
    expect(update.error).toBeTruthy();
    expect(update.error!.code).toBe(-32003);

    // With write:graph granted, the same calls succeed.
    const { token: full, sessionId: fullSession } = await setupToken(["write:issue", "write:graph"]);
    const ok = await callTool(full, fullSession, "create_issue", {
      title: "scope child ok",
      parent_id: parent.id,
    });
    expect(ok.error).toBeUndefined();
  });

  it("requires per-tool scopes (missing scope rejected)", async () => {
    const { token, sessionId } = await setupToken(["read:issue"]);
    const res = await callTool(token, sessionId, "add_comment", {
      issue_id: (await createIssue({ title: "scope" })).id,
      body: "should fail",
    });
    expect(res.error).toBeTruthy();
    expect(res.error!.code).toBe(-32003);
  });

  it("rejects calls from revoked tokens on subsequent requests", async () => {
    const { token } = await createMcpToken(["read:issue"]);
    const { sessionId } = await mcpInitialize(token);
    const ok = await mcpCall(token, "ping", {}, sessionId);
    expect(ok.status).toBe(200);

    // Find the token id via the API and revoke it.
    const tokens = (await api("/api/tokens")).body as { id: string; name: string }[];
    const created = tokens.find((t) => t.name === "integration-test")!;
    await post(`/api/tokens/${created.id}/revoke`, {});

    const after = await mcpCall(token, "ping", {}, sessionId);
    expect(after.status).toBe(401);
  });
});
