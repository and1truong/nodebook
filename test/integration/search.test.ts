/** Full-text search: indexing, ranking, filters, rebuild consistency. */
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { api, createIssue, post, testEnv } from "./helpers";
import { systemCtx } from "../../src/server/ctx";
import { rebuildSearchIndex } from "../../src/server/services/search-service";
import { countSearchDocs } from "../../src/server/repositories/search";

async function search(q: string, extra = ""): Promise<{ query: string; results: unknown[] }> {
  const res = await api(`/api/search?q=${encodeURIComponent(q)}${extra}`);
  return res.body as { query: string; results: unknown[] };
}

describe("search", () => {
  it("indexes titles and bodies with ranked results", async () => {
    await createIssue({ title: "alpha bravo charlie", body: "distinctive zebra pattern" });
    await createIssue({ title: "alpha only" });

    const res = await search("charlie");
    const results = res.results as { issue_title: string; snippet: string }[];
    expect(results.some((r) => r.issue_title === "alpha bravo charlie")).toBe(true);

    const titleSearch = await search("alpha");
    expect((titleSearch.results as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("indexes comments and labels", async () => {
    const issue = await createIssue({ title: "searchable issue", labels: ["neptunium"] });
    await post(`/api/issues/${issue.number}/comments`, { body: "the frabjous comment text" });

    const byLabel = await search("neptunium");
    expect((byLabel.results as unknown[]).length).toBeGreaterThanOrEqual(1);

    const byComment = await search("frabjous");
    const results = byComment.results as { matched_field: string }[];
    expect(results.some((r) => r.matched_field === "comment")).toBe(true);
  });

  it("indexes comment attachments under their owning issue", async () => {
    const issue = await createIssue({ title: "comment attachment host" });
    const comment = await post(`/api/issues/${issue.number}/comments`, { body: "please attach here" });
    const commentId = (comment.body as { id: string }).id;

    const form = new FormData();
    form.append("file", new File(["payload"], "quagga-report.xlsx", { type: "application/vnd.ms-excel" }));
    const upload = await SELF.fetch(`https://nodebook.test/api/attachments/comment/${commentId}`, {
      method: "POST",
      body: form,
    });
    expect(upload.status).toBe(201);

    const found = await search("quagga-report");
    const results = found.results as { matched_field: string; issue_number: number }[];
    expect(results.some((r) => r.matched_field === "attachment" && r.issue_number === issue.number)).toBe(true);
  });

  it("handles punctuation, operators, and empty queries safely", async () => {
    await createIssue({ title: "punct;uation test" });
    // Punctuation splits into terms; operator-like words are quoted (safe, no error).
    const punct = await search("punct;uation test");
    expect((punct.results as unknown[]).length).toBeGreaterThanOrEqual(1);
    const operators = await search('"OR" "NOT" AND');
    expect(operators.results).toEqual([]); // no error, just no match
    const empty = await search("");
    expect(empty.results).toEqual([]);
    const symbols = await search("!!! ??? ...");
    expect(symbols.results).toEqual([]);
  });

  it("applies type, status, and label filters", async () => {
    await createIssue({ title: "filtered bug", type: "bug", labels: ["flt"] });
    await createIssue({ title: "filtered wiki", type: "wiki", labels: ["flt"] });

    const bugs = await search("filtered", "&type=bug");
    const bugResults = bugs.results as { issue_type: string }[];
    expect(bugResults.length).toBeGreaterThanOrEqual(1);
    expect(bugResults.every((r) => r.issue_type === "bug")).toBe(true);

    const closedOnly = await search("filtered", "&status=closed");
    expect(closedOnly.results).toEqual([]);
  });

  it("prioritizes knowledge types in search_knowledge", async () => {
    await createIssue({ title: "knowledge ranking topic", type: "wiki" });
    await createIssue({ title: "knowledge ranking topic", type: "task" });

    const res = await api(`/api/search/knowledge?q=${encodeURIComponent("knowledge ranking topic")}`);
    const results = res.body as { results: { issue_type: string }[] };
    const types = results.results.map((r) => r.issue_type);
    expect(types[0]).toBe("wiki");
    expect(types).toContain("task");
  });

  it("rebuilds the index idempotently and stays consistent with mutations", async () => {
    const issue = await createIssue({ title: "rebuild me", body: "unique-content-token-xyz" });
    const before = (await search("unique-content-token-xyz")).results.length;
    expect(before).toBeGreaterThanOrEqual(1);

    const env = testEnv();
    const ctx = systemCtx(env);
    const counts = await rebuildSearchIndex(ctx);
    expect(counts.issues).toBeGreaterThanOrEqual(1);

    const after = (await search("unique-content-token-xyz")).results.length;
    expect(after).toBe(before);

    const twice = await rebuildSearchIndex(ctx);
    expect(twice.issues).toBe(counts.issues);

    const docCount = await countSearchDocs(env.DB);
    expect(docCount).toBe(counts.issues + counts.comments + counts.attachments);

    // Mutations after rebuild stay indexed.
    await createIssue({ title: "post-rebuild marker", body: "post-rebuild-token-abc" });
    const post = await search("post-rebuild-token-abc");
    expect(post.results.length).toBeGreaterThanOrEqual(1);
    void issue;
  });
});
