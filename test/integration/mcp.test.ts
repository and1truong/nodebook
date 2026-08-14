/** MCP: protocol tests, one test per tool family, scopes, parity with HTTP. */
import { describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import { api, createIssue, createMcpToken, mcpCall, mcpInitialize, OWNER, patch, post } from "./helpers";

async function callTool(
  token: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{
  result?: unknown;
  structuredResult?: unknown;
  error?: { code: number; message: string; data?: unknown };
}> {
  const res = await mcpCall(token, "tools/call", { name, arguments: args }, sessionId);
  if (res.body.error) return { error: res.body.error as { code: number; message: string; data?: unknown } };
  const toolResult = res.body.result as { content: { text: string }[]; structuredContent?: unknown };
  const content = toolResult.content[0]!.text;
  return { result: JSON.parse(content) as unknown, structuredResult: toolResult.structuredContent };
}

async function setupToken(scopes: string[]): Promise<{ token: string; tokenId: string; sessionId: string }> {
  const { token, id: tokenId } = await createMcpToken(scopes);
  const { sessionId } = await mcpInitialize(token);
  return { token, tokenId, sessionId };
}

describe("MCP tools", () => {
  it("get_issue and search_issues (read)", async () => {
    const issue = await createIssue({ title: "mcp readable", body: "mcp-token-body-123" });
    const { token, sessionId } = await setupToken(["read:issue", "read:search"]);

    const got = await callTool(token, sessionId, "get_issue", { number: issue.number });
    expect((got.result as { title: string }).title).toBe("mcp readable");
    const gotByUuid = await callTool(token, sessionId, "get_issue", { issue_id: issue.id });
    expect(gotByUuid.result).toMatchObject({ id: issue.id, number: issue.number });

    const searched = await callTool(token, sessionId, "search_issues", { query: "mcp-token-body-123" });
    expect((searched.result as { count: number }).count).toBeGreaterThanOrEqual(1);
  });

  it("list_labels returns metadata in case-insensitive order without duplicates", async () => {
    await createIssue({ title: "first labelled issue", labels: ["zebra", "Alpha", "shared"] });
    await createIssue({ title: "second labelled issue", labels: ["beta", "SHARED"] });
    const { token, sessionId } = await setupToken(["read:issue"]);

    const listed = await callTool(token, sessionId, "list_labels", {});
    const labels = listed.result as { id: string; name: string; color: string | null; created_at: string }[];

    expect(labels.map((label) => label.name)).toEqual(["Alpha", "beta", "shared", "zebra"]);
    expect(labels.filter((label) => label.name.toLowerCase() === "shared")).toHaveLength(1);
    for (const label of labels) {
      expect(label.id).toEqual(expect.any(String));
      expect(label.color).toBeNull();
      expect(Number.isNaN(new Date(label.created_at).getTime())).toBe(false);
    }
  });

  it("list_labels returns an empty array for an empty workspace", async () => {
    const { token, sessionId } = await setupToken(["read:issue"]);
    const listed = await callTool(token, sessionId, "list_labels", {});
    expect(listed.result).toEqual([]);
  });

  it("list_labels requires read:issue", async () => {
    const { token, sessionId } = await setupToken(["read:search"]);
    const listed = await callTool(token, sessionId, "list_labels", {});
    expect(listed.error?.code).toBe(-32003);
    expect(listed.error?.message).toContain("read:issue");
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

    const invalidTimezone = await callTool(token, sessionId, "get_today", { timezone: "Not/A_Timezone" });
    expect(invalidTimezone.error?.code).toBe(-32602);
  });

  it("create_issue, update_issue, close_issue, complete_task (write issue)", async () => {
    const { token, sessionId } = await setupToken(["write:issue"]);

    const created = await callTool(token, sessionId, "create_issue", { title: "mcp created", type: "task" });
    const issue = created.result as { id: string; number: number; status: string; version: number };
    expect(issue.status).toBe("open");

    const updated = await callTool(token, sessionId, "update_issue", {
      issue_id: issue.id,
      expected_version: issue.version,
      priority: "high",
    });
    expect((updated.result as { priority: string }).priority).toBe("high");

    const closed = await callTool(token, sessionId, "close_issue", { issue_id: issue.id });
    expect((closed.result as { status: string }).status).toBe("closed");
    const alreadyClosed = await callTool(token, sessionId, "close_issue", { issue_id: issue.number });
    expect(alreadyClosed.error?.code).toBe(-32008);

    // Non-recurring complete_task on an open issue closes it.
    const fresh = await callTool(token, sessionId, "create_issue", { title: "mcp complete" });
    const freshIssue = fresh.result as { id: string };
    const completed = await callTool(token, sessionId, "complete_task", { issue_id: freshIssue.id });
    expect((completed.result as { status: string }).status).toBe("closed");
  });

  it("persists MCP actor and human owner attribution across write families", async () => {
    const { token, tokenId, sessionId } = await setupToken([
      "write:issue",
      "write:comment",
      "write:graph",
      "write:reminder",
      "write:attachment",
    ]);
    const expectedCreator = {
      actor_type: "mcp",
      actor_id: tokenId,
      user_id: OWNER,
      email: OWNER,
      display_name: "Test Owner",
      via: "mcp",
    };

    const created = await callTool(token, sessionId, "create_issue", { title: "attributed MCP issue" });
    const issue = created.result as {
      id: string;
      number: number;
      version: number;
      created_by: string;
      creator: Record<string, unknown>;
    };
    expect(issue.created_by).toBe(`mcp:${tokenId}`);
    expect(issue.creator).toEqual(expectedCreator);
    expect(created.structuredResult).toEqual(created.result);

    const comment = await callTool(token, sessionId, "add_comment", {
      issue_id: issue.id,
      body: "attributed MCP comment",
    });
    expect(comment.result).toMatchObject({
      author: `mcp:${tokenId}`,
      author_type: "mcp",
      creator: expectedCreator,
    });

    const child = await callTool(token, sessionId, "add_child", {
      parent_id: issue.id,
      title: "attributed child",
    });
    expect(child.result).toMatchObject({ created_by: `mcp:${tokenId}`, creator: expectedCreator });
    const childId = (child.result as { id: string }).id;

    const relationship = await callTool(token, sessionId, "link_issues", {
      source_id: issue.id,
      target_id: childId,
      type: "related",
    });
    expect(relationship.result).toMatchObject({ created_by: `mcp:${tokenId}`, creator: expectedCreator });

    const reminder = await callTool(token, sessionId, "create_reminder", {
      issue_id: issue.id,
      kind: "absolute",
      trigger_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(reminder.result).toMatchObject({ creator: expectedCreator });

    const attachment = await callTool(token, sessionId, "attach_file", {
      issue_id: issue.id,
      filename: "attributed.txt",
      content_type: "text/plain",
      data: btoa("attribution"),
    });
    expect(attachment.result).toMatchObject({ creator: expectedCreator });

    const updated = await callTool(token, sessionId, "update_issue", {
      issue_id: issue.id,
      expected_version: issue.version,
      title: "attributed MCP issue updated",
    });
    const updatedVersion = (updated.result as { version: number }).version;
    expect(updatedVersion).toBe(issue.version + 1);
    await callTool(token, sessionId, "close_issue", { issue_id: issue.id });

    const issueRow = await env.DB.prepare(
      "SELECT created_by, created_for, created_via FROM issues WHERE id = ?",
    ).bind(issue.id).first<{ created_by: string; created_for: string; created_via: string }>();
    expect(issueRow).toEqual({ created_by: `mcp:${tokenId}`, created_for: OWNER, created_via: "mcp" });

    const commentRow = await env.DB.prepare(
      "SELECT author, author_for, author_via FROM comments WHERE issue_id = ?",
    ).bind(issue.id).first<{ author: string; author_for: string; author_via: string }>();
    expect(commentRow).toEqual({ author: `mcp:${tokenId}`, author_for: OWNER, author_via: "mcp" });

    const audit = await env.DB.prepare(
      `SELECT action, actor_type, actor_id, subject_email, via FROM audit_events
       WHERE actor_type = 'mcp' AND actor_id = ?`,
    ).bind(tokenId).all<{
      action: string;
      actor_type: string;
      actor_id: string;
      subject_email: string;
      via: string;
    }>();
    expect(audit.results.map((event) => event.action)).toEqual(expect.arrayContaining([
      "issue.create",
      "comment.create",
      "relationship.create",
      "reminder.create",
      "attachment.upload",
      "issue.update",
      "issue.close",
    ]));
    for (const event of audit.results) {
      expect(event).toMatchObject({ actor_type: "mcp", actor_id: tokenId, subject_email: OWNER, via: "mcp" });
    }
  });

  it("keeps direct human attribution and safely resolves historical MCP principals", async () => {
    const human = await createIssue({ title: "direct human attribution" });
    const humanCreator = {
      actor_type: "human",
      actor_id: OWNER,
      user_id: OWNER,
      email: OWNER,
      display_name: "Test Owner",
      via: "web",
    };
    expect(human).toMatchObject({ created_by: OWNER, creator: humanCreator });
    const humanComment = await post(`/api/issues/${human.number}/comments`, { body: "direct human comment" });
    expect(humanComment.body).toMatchObject({
      author: OWNER,
      author_type: "human",
      creator: humanCreator,
    });

    const { token, tokenId, sessionId } = await setupToken(["write:issue"]);
    const created = await callTool(token, sessionId, "create_issue", { title: "historical mapping" });
    const issue = created.result as { id: string; number: number };

    // Simulate a pre-0010 row, which has only the raw principal. Revocation
    // retains the canonical connection row and therefore remains readable.
    await env.DB.prepare("UPDATE issues SET created_for = NULL WHERE id = ?").bind(issue.id).run();
    await post(`/api/tokens/${tokenId}/revoke`, {});
    const revoked = (await api(`/api/issues/${issue.number}`)).body as {
      created_by: string;
      creator: { display_name: string; actor_id: string; email: string | null; via: string };
    };
    expect(revoked.created_by).toBe(`mcp:${tokenId}`);
    expect(revoked.creator).toMatchObject({
      actor_id: tokenId,
      email: OWNER,
      display_name: "Test Owner",
      via: "mcp",
    });

    // If an old connection was hard-deleted, display attribution must not
    // block or invalidate the content; the auditable principal stays intact.
    await env.DB.prepare("DELETE FROM mcp_tokens WHERE id = ?").bind(tokenId).run();
    const missing = (await api(`/api/issues/${issue.number}`)).body as {
      created_by: string;
      creator: { display_name: string; actor_id: string; email: string | null; via: string };
    };
    expect(missing.created_by).toBe(`mcp:${tokenId}`);
    expect(missing.creator).toEqual({
      actor_type: "mcp",
      actor_id: tokenId,
      user_id: null,
      email: null,
      display_name: "MCP client",
      via: "mcp",
    });
  });

  it("persists partial issue updates by number and UUID and returns the persisted state", async () => {
    const issue = await createIssue({ title: "learn - temporal", body: "" });
    const { token, sessionId } = await setupToken(["read:issue", "write:issue"]);

    const before = await callTool(token, sessionId, "get_issue", { number: issue.number });
    const snapshot = before.result as { id: string; body: string; updated_at: string; version: number };
    expect(snapshot.body).toBe("");

    // Original regression: a number identifier and a body-only patch from
    // empty to non-empty must survive schema parsing and reach the UUID CAS.
    const byNumber = await callTool(token, sessionId, "update_issue", {
      issue_id: issue.number,
      expected_version: snapshot.version,
      body: "some non-empty markdown content",
    });
    const firstUpdate = byNumber.result as { id: string; body: string; updated_at: string; version: number };
    expect(byNumber.error).toBeUndefined();
    expect(firstUpdate).toMatchObject({
      id: snapshot.id,
      body: "some non-empty markdown content",
      version: snapshot.version + 1,
    });
    expect(firstUpdate.updated_at).not.toBe(snapshot.updated_at);
    expect(byNumber.structuredResult).toEqual(byNumber.result);

    const fetched = await callTool(token, sessionId, "get_issue", { number: issue.number });
    expect(fetched.result).toMatchObject({
      body: "some non-empty markdown content",
      version: snapshot.version + 1,
    });

    // UUID resolution, title/multi-field updates, and a non-empty to empty
    // body transition. Empty strings must not be lost to a truthiness check.
    const byUuid = await callTool(token, sessionId, "update_issue", {
      issue_id: snapshot.id,
      expected_version: firstUpdate.version,
      title: "learn - temporal updated",
      body: "",
      priority: "high",
    });
    const secondUpdate = byUuid.result as { title: string; body: string; priority: string | null; version: number };
    expect(secondUpdate).toMatchObject({
      title: "learn - temporal updated",
      body: "",
      priority: "high",
      version: firstUpdate.version + 1,
    });

    // Explicit null is supported for nullable fields and is also a real patch.
    const nullable = await callTool(token, sessionId, "update_issue", {
      issue_id: snapshot.id,
      expected_version: secondUpdate.version,
      priority: null,
    });
    expect(nullable.result).toMatchObject({ priority: null, version: secondUpdate.version + 1 });
  });

  it("reports nonexistent issues and database write failures through MCP", async () => {
    const { token, sessionId } = await setupToken(["write:issue"]);

    for (const issueId of [2_000_000_000, crypto.randomUUID()]) {
      const missing = await callTool(token, sessionId, "update_issue", {
        issue_id: issueId,
        expected_version: 1,
        body: "cannot be written",
      });
      expect(missing.error).toMatchObject({ code: -32004 });
      expect(missing.error?.message).toContain("not found");
    }

    const issue = await createIssue({ title: "forced MCP database failure", body: "before" });
    await env.DB.prepare(
      `CREATE TRIGGER fail_mcp_issue_update
       BEFORE UPDATE OF body ON issues
       WHEN OLD.id = '${issue.id}'
       BEGIN SELECT RAISE(FAIL, 'forced MCP update failure'); END`,
    ).run();
    try {
      const failed = await callTool(token, sessionId, "update_issue", {
        issue_id: issue.number,
        expected_version: issue.version,
        body: "after",
      });
      expect(failed.error).toMatchObject({ code: -32603 });
      expect(failed.result).toBeUndefined();

      const persisted = (await api(`/api/issues/${issue.number}`)).body as { body: string; version: number };
      expect(persisted).toMatchObject({ body: "before", version: issue.version });
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_mcp_issue_update").run();
    }
  });

  it("allows only one of two concurrent updates at the same expected version", async () => {
    const issue = await createIssue({ title: "MCP compare and swap" });
    const { token, sessionId } = await setupToken(["write:issue"]);

    const results = await Promise.all([
      callTool(token, sessionId, "update_issue", {
        issue_id: issue.number,
        expected_version: issue.version,
        title: "number won",
      }),
      callTool(token, sessionId, "update_issue", {
        issue_id: issue.id,
        expected_version: issue.version,
        title: "UUID won",
      }),
    ]);

    const successes = results.filter((result) => result.result !== undefined);
    const conflicts = results.filter((result) => result.error?.code === -32009);
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(successes[0]!.result).toMatchObject({ version: Number(issue.version) + 1 });

    const persisted = (await api(`/api/issues/${issue.number}`)).body as { title: string; version: number };
    expect(["number won", "UUID won"]).toContain(persisted.title);
    expect(persisted.version).toBe(Number(issue.version) + 1);
  });

  it("prevents stale edits across HTTP and MCP in both directions", async () => {
    const issue = await createIssue({ title: "shared editor" });
    const { token, sessionId } = await setupToken(["read:issue", "write:issue"]);

    const read = await callTool(token, sessionId, "get_issue", { number: issue.number });
    const mcpSnapshot = read.result as { id: string; version: number };
    const human = await patch(`/api/issues/${issue.number}`, {
      expected_version: issue.version,
      title: "human won",
    });
    expect(human.status).toBe(200);

    const staleMcp = await callTool(token, sessionId, "update_issue", {
      issue_id: mcpSnapshot.id,
      expected_version: mcpSnapshot.version,
      title: "stale MCP",
    });
    expect(staleMcp.error).toMatchObject({
      code: -32009,
      data: {
        expected_version: mcpSnapshot.version,
        current_version: mcpSnapshot.version + 1,
      },
    });

    const latest = await callTool(token, sessionId, "get_issue", { number: issue.number });
    const current = latest.result as { id: string; version: number };
    const mcpWinner = await callTool(token, sessionId, "update_issue", {
      issue_id: current.id,
      expected_version: current.version,
      title: "MCP won",
    });
    expect((mcpWinner.result as { title: string }).title).toBe("MCP won");

    const staleHuman = await patch(`/api/issues/${issue.number}`, {
      expected_version: current.version,
      title: "stale human",
    });
    expect(staleHuman.status).toBe(409);
    const final = (await api(`/api/issues/${issue.number}`)).body as { title: string };
    expect(final.title).toBe("MCP won");
  });

  it("requires expected_version for MCP issue updates", async () => {
    const issue = await createIssue({ title: "MCP version required" });
    const { token, sessionId } = await setupToken(["write:issue"]);
    const result = await callTool(token, sessionId, "update_issue", {
      issue_id: issue.id,
      title: "not accepted",
    });
    expect(result.error?.code).toBe(-32602);
  });

  it("rejects MCP issue updates with no fields to change", async () => {
    const issue = await createIssue({ title: "MCP no-op" });
    const { token, sessionId } = await setupToken(["write:issue"]);
    const result = await callTool(token, sessionId, "update_issue", {
      issue_id: issue.id,
      expected_version: issue.version,
    });
    expect(result.error?.code).toBe(-32602);
  });

  it("add_comment, add_child, link_issues (write comment/graph)", async () => {
    const parent = await createIssue({ title: "mcp tree root" });
    const { token, sessionId } = await setupToken(["write:comment", "write:graph"]);

    const child = await callTool(token, sessionId, "add_child", {
      parent_id: parent.number,
      title: "mcp child",
    });
    const childIssue = child.result as { id: string; number: number; parent_number: number | null };
    expect(childIssue.parent_number).toBe(parent.number);

    const comment = await callTool(token, sessionId, "add_comment", {
      issue_id: childIssue.id,
      body: "from mcp",
    });
    expect((comment.result as { body: string }).body).toBe("from mcp");
    const emptyComment = await callTool(token, sessionId, "add_comment", {
      issue_id: childIssue.number,
      body: "   ",
    });
    expect(emptyComment.error?.code).toBe(-32602);

    const link = await callTool(token, sessionId, "link_issues", {
      source_id: parent.number,
      target_id: childIssue.number,
      type: "depends_on",
    });
    expect((link.result as { type: string }).type).toBe("depends_on");
    const duplicate = await callTool(token, sessionId, "link_issues", {
      source_id: parent.number,
      target_id: childIssue.number,
      type: "depends_on",
    });
    expect(duplicate.error?.code).toBe(-32008);
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
    expect(dismissed.structuredResult).toEqual(dismissed.result);

    for (const invalid of [
      { reminder_id: reminder.id },
      { reminder_id: reminder.id, status: "snoozed" },
      { reminder_id: reminder.id, snooze_until: new Date(Date.now() + 7_200_000).toISOString() },
      {
        reminder_id: reminder.id,
        status: "dismissed",
        trigger_at: new Date(Date.now() + 7_200_000).toISOString(),
      },
    ]) {
      const rejected = await callTool(token, sessionId, "update_reminder", invalid);
      expect(rejected.error?.code).toBe(-32602);
    }
  });

  it("validates reminder kind-specific arguments at the MCP boundary", async () => {
    const issue = await createIssue({ title: "mcp reminder validation" });
    const { token, sessionId } = await setupToken(["write:reminder"]);

    for (const invalid of [
      { issue_id: issue.number, kind: "absolute" },
      { issue_id: issue.number, kind: "before_due" },
      { issue_id: issue.number, kind: "recurring" },
    ]) {
      const rejected = await callTool(token, sessionId, "create_reminder", invalid);
      expect(rejected.error?.code).toBe(-32602);
    }
  });

  it("list_attachments and attach_file (read/write attachment)", async () => {
    const issue = await createIssue({ title: "mcp files" });
    const { token, sessionId } = await setupToken(["read:attachment", "write:attachment"]);

    const data = btoa("mcp attachment bytes");
    const attached = await callTool(token, sessionId, "attach_file", {
      issue_id: issue.number,
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

  it("rejects invalid and oversized attach_file data", async () => {
    const issue = await createIssue({ title: "mcp big file" });
    const { token, sessionId } = await setupToken(["write:attachment"]);

    const invalid = await callTool(token, sessionId, "attach_file", {
      issue_id: issue.id,
      filename: "invalid.bin",
      data: "%%%not-base64%%%",
    });
    expect(invalid.error?.code).toBe(-32602);

    const big = btoa("x".repeat(5 * 1024 * 1024 + 1024));
    const oversized = await callTool(token, sessionId, "attach_file", {
      issue_id: issue.id,
      filename: "big.bin",
      data: big,
    });
    expect(oversized.error?.code).toBe(-32005);
    expect(oversized.error!.message).toContain("limit");
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
      expected_version: child.version,
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

  it("answers CORS preflights without a bearer token", async () => {
    // A cross-origin browser MCP client sends OPTIONS with no Authorization
    // header; the middleware must let it through so the /mcp route can emit
    // the configured CORS headers (otherwise MCP_CORS_ORIGINS is unusable).
    const res = await SELF.fetch("https://nodebook.test/mcp", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com", "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");

    // The subsequent authenticated request is still required (and enforced).
    const noToken = await SELF.fetch("https://nodebook.test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(noToken.status).toBe(401);
  });
});
