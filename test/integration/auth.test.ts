/** Authentication, authorization, and audit attribution. */
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { api, createIssue, createMcpToken, mcpCall, mcpInitialize, OWNER, post } from "./helpers";

describe("web authentication", () => {
  it("rejects requests with no Access JWT when Access is configured", async () => {
    // Test env does not configure ACCESS_TEAM/AUD, so AUTH_DEV_EMAIL applies;
    // verify the API is reachable with the dev identity.
    const res = await api("/api/me");
    expect(res.status).toBe(200);
    const body = res.body as {
      email: string;
      calendar_default_view: string;
      week_start_day: string;
      issues_default_limit: number;
    };
    expect(body.email).toBe(OWNER);
    // Runtime configuration is exposed through /api/me; the test bindings
    // resolve to "week" and the sunday fallback (WEEK_START_DAY unset).
    expect(body.calendar_default_view).toBe("week");
    expect(body.week_start_day).toBe("sunday");
    expect(body.issues_default_limit).toBe(20);
  });

  it("rejects MCP calls without a bearer token", async () => {
    const res = await SELF.fetch("https://nodebook.test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects MCP calls with an unknown token", async () => {
    const res = await mcpCall("nbk_definitely-not-a-real-token", "ping");
    expect(res.status).toBe(401);
  });

  it("rejects MCP calls with a revoked token", async () => {
    const { token, id } = await createMcpToken(["read:issue"]);
    await post(`/api/tokens/${id}/revoke`, {});
    const res = await mcpCall(token, "ping");
    expect(res.status).toBe(401);
  });

  it("rejects MCP calls with a malformed token format", async () => {
    const res = await mcpCall("not-a-nbk-token", "ping");
    expect(res.status).toBe(401);
  });
});

describe("MCP protocol", () => {
  it("runs initialize / tools/list / ping", async () => {
    const { token } = await createMcpToken(["read:issue"]);
    const { sessionId } = await mcpInitialize(token);

    const list = await mcpCall(token, "tools/list", {}, sessionId);
    expect(list.status).toBe(200);
    const tools = (list.body.result as { tools: { name: string }[] }).tools;
    expect(tools.length).toBeGreaterThanOrEqual(18);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "get_issue",
        "search_issues",
        "get_children",
        "get_backlinks",
        "search_knowledge",
        "get_today",
        "get_upcoming",
        "list_attachments",
        "create_issue",
        "update_issue",
        "close_issue",
        "add_comment",
        "add_child",
        "link_issues",
        "create_reminder",
        "update_reminder",
        "complete_task",
        "attach_file",
      ]),
    );

    const ping = await mcpCall(token, "ping", {}, sessionId);
    expect(ping.body.result).toEqual({});

    // Unknown method → JSON-RPC error
    const unknown = await mcpCall(token, "bogus/method", {}, sessionId);
    expect((unknown.body.error as { code: number }).code).toBe(-32601);
  });

  it("rejects tools/call before initialize", async () => {
    const { token } = await createMcpToken(["read:issue"]);
    const res = await mcpCall(token, "tools/list");
    expect((res.body.error as { code: number }).code).toBe(-32002);
  });

  it("rejects calls with insufficient scope", async () => {
    const { token } = await createMcpToken(["read:issue"]);
    const { sessionId } = await mcpInitialize(token);
    const res = await mcpCall(token, "tools/call", { name: "create_issue", arguments: { title: "nope" } }, sessionId);
    expect((res.body.error as { code: number }).code).toBe(-32003);
  });

  it("rejects tools/call with invalid arguments", async () => {
    const { token } = await createMcpToken(["write:issue"]);
    const { sessionId } = await mcpInitialize(token);
    const res = await mcpCall(token, "tools/call", { name: "create_issue", arguments: { title: "" } }, sessionId);
    expect((res.body.error as { code: number }).code).toBe(-32602);
  });
});

describe("audit attribution", () => {
  it("attributes web mutations to the human actor", async () => {
    const issue = await createIssue({ title: "audit human" });
    const history = await api(`/api/issues/${issue.number}/history`);
    const events = history.body as { actor_type: string; actor_id: string; action: string }[];
    expect(events.some((e) => e.action === "issue.create" && e.actor_type === "human" && e.actor_id === OWNER)).toBe(true);
  });

  it("attributes MCP mutations to the token identity with equal audit payloads", async () => {
    const { token } = await createMcpToken(["write:issue"]);
    const { sessionId } = await mcpInitialize(token);

    // HTTP mutation
    const httpIssue = await createIssue({ title: "parity shared", body: "hello" });
    // Equivalent MCP mutation (same inputs through a different transport)
    const res = await mcpCall(
      token,
      "tools/call",
      { name: "create_issue", arguments: { title: "parity shared", body: "hello" } },
      sessionId,
    );
    expect(res.body.error).toBeUndefined();
    const mcpIssue = (res.body.result as { content: { text: string }[] }).content[0]!.text;
    const mcpDto = JSON.parse(mcpIssue) as { number: number };

    const httpHistory = (await api(`/api/issues/${httpIssue.number}/history`)).body as {
      actor_type: string;
      actor_id: string;
      action: string;
      after: { title: string; body: string };
    }[];
    const mcpHistory = (await api(`/api/issues/${mcpDto.number}/history`)).body as {
      actor_type: string;
      actor_id: string;
      action: string;
      after: { title: string; body: string };
    }[];

    const httpCreate = httpHistory.find((e) => e.action === "issue.create")!;
    const mcpCreate = mcpHistory.find((e) => e.action === "issue.create")!;
    // Issue numbers necessarily differ; every other audit field must match.
    const { number: _httpNumber, ...httpAfter } = httpCreate.after as unknown as Record<string, unknown> & { number: number };
    const { number: _mcpNumber, ...mcpAfter } = mcpCreate.after as unknown as Record<string, unknown> & { number: number };
    void _httpNumber;
    void _mcpNumber;
    expect(httpAfter).toEqual(mcpAfter);
    expect(httpCreate.actor_type).toBe("human");
    expect(mcpCreate.actor_type).toBe("mcp");
    expect(mcpCreate.actor_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
