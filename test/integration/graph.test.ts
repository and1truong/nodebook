/** Hierarchy, typed relationships, references (incl. late resolution), wiki. */
import { describe, expect, it } from "vitest";
import { api, createIssue, patch, post, testEnv } from "./helpers";

describe("hierarchy", () => {
  it("rejects self-parenting and cycles", async () => {
    const root = await createIssue({ title: "root" });
    const child = await createIssue({ title: "child" });

    const self = await post(`/api/graph/${child.number}/parent`, { parent_id: child.id });
    expect(self.status).toBe(400);

    const ok = await post(`/api/graph/${child.number}/parent`, { parent_id: root.id });
    expect(ok.status).toBe(200);

    // Making root a child of its own child would create a cycle.
    const cycle = await post(`/api/graph/${root.number}/parent`, { parent_id: child.id });
    expect(cycle.status).toBe(409);

    // Missing parent
    const missing = await post(`/api/graph/${child.number}/parent`, { parent_id: "00000000-0000-0000-0000-000000000000" });
    expect(missing.status).toBe(404);

    // Unparent works
    const unparent = await post(`/api/graph/${child.number}/parent`, { parent_id: null });
    expect(unparent.status).toBe(200);
  });

  it("lists children with counts", async () => {
    const root = await createIssue({ title: "root2" });
    const a = await createIssue({ title: "child a" });
    const b = await createIssue({ title: "child b" });
    await post(`/api/graph/${a.number}/parent`, { parent_id: root.id });
    await post(`/api/graph/${b.number}/parent`, { parent_id: root.id });

    const children = await api(`/api/graph/${root.number}/children`);
    expect((children.body as { number: number }[]).map((c) => c.number).sort()).toEqual(
      [a.number, b.number].sort(),
    );

    const detail = await api(`/api/issues/${root.number}`);
    expect((detail.body as { child_count: number }).child_count).toBe(2);
  });
});

describe("relationships", () => {
  it("creates typed relationships and rejects duplicates", async () => {
    const a = await createIssue({ title: "rel a" });
    const b = await createIssue({ title: "rel b" });

    for (const type of ["related", "depends_on", "blocks", "supersedes", "duplicates"]) {
      const res = await post(`/api/graph/${a.number}/relationships`, { target_id: b.id, type });
      expect(res.status).toBe(201);
      const dup = await post(`/api/graph/${a.number}/relationships`, { target_id: b.id, type });
      expect(dup.status).toBe(409);
    }

    // Self-relationship
    const self = await post(`/api/graph/${a.number}/relationships`, { target_id: a.id, type: "related" });
    expect(self.status).toBe(400);
  });

  it("rejects inverse duplicates for directional types", async () => {
    const a = await createIssue({ title: "dir a" });
    const b = await createIssue({ title: "dir b" });
    await post(`/api/graph/${a.number}/relationships`, { target_id: b.id, type: "depends_on" });
    const inverse = await post(`/api/graph/${b.number}/relationships`, { target_id: a.id, type: "depends_on" });
    expect(inverse.status).toBe(409);
  });

  it("exposes relationships from both directions and removes them", async () => {
    const a = await createIssue({ title: "both a" });
    const b = await createIssue({ title: "both b" });
    const created = await post(`/api/graph/${a.number}/relationships`, { target_id: b.id, type: "blocks" });
    const rel = created.body as { id: string; source_number: number; target_number: number };

    const fromA = await api(`/api/graph/${a.number}/relationships`);
    const fromB = await api(`/api/graph/${b.number}/relationships`);
    expect((fromA.body as unknown[]).length).toBe(1);
    expect((fromB.body as unknown[]).length).toBe(1);

    const del = await api(`/api/graph/relationships/${rel.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = await api(`/api/graph/${a.number}/relationships`);
    expect((after.body as unknown[]).length).toBe(0);
  });
});

describe("references", () => {
  it("stores references from issue bodies and exposes backlinks", async () => {
    const target = await createIssue({ title: "target" });
    const source = await createIssue({ title: "source", body: `See #${target.number} for details` });
    void source;

    const backlinks = await api(`/api/graph/${target.number}/backlinks`);
    const links = backlinks.body as { source_number: number; source_title: string }[];
    expect(links).toHaveLength(1);
    expect(links[0]!.source_number).toBe(source.number);
  });

  it("resolves late references when the target number is created later", async () => {
    // Numbers are allocated sequentially: allocator (N), source (N+1),
    // commentHost (N+2), target (N+3). Reference the target's number before
    // it exists, from both an issue body and a comment.
    const allocator = await createIssue({ title: "allocator" });
    const source = await createIssue({ title: "forward ref" });
    const commentHost = await createIssue({ title: "comment ref host" });
    const targetNumber = allocator.number + 3;

    await patch(`/api/issues/${source.number}`, { body: `depends on #${targetNumber}` });
    const commentRes = await post(`/api/issues/${commentHost.number}/comments`, {
      body: `waiting on #${targetNumber}`,
    });
    expect(commentRes.status).toBe(201);

    // Before the target exists, the references are stored but unresolved.
    const before = await testEnv().DB.prepare(
      "SELECT target_issue_id FROM issue_references WHERE target_number = ?",
    )
      .bind(targetNumber)
      .all<{ target_issue_id: string | null }>();
    expect(before.results.length).toBe(2);
    expect(before.results.every((r) => r.target_issue_id === null)).toBe(true);

    const target = await createIssue({ title: "the awaited one" });
    expect(target.number).toBe(targetNumber);

    // Both references now resolve to the new issue.
    const resolved = await testEnv().DB.prepare(
      "SELECT target_issue_id FROM issue_references WHERE target_number = ?",
    )
      .bind(targetNumber)
      .all<{ target_issue_id: string | null }>();
    expect(resolved.results.every((r) => r.target_issue_id === target.id)).toBe(true);

    const backlinks = await api(`/api/graph/${target.number}/backlinks`);
    const links = backlinks.body as { source_type: string; source_title: string }[];
    expect(links.some((l) => l.source_type === "issue" && l.source_title === source.title)).toBe(true);
    expect(
      links.some((l) => l.source_type === "comment" && l.source_title?.includes(`#${commentHost.number}`)),
    ).toBe(true);
  });

  it("excludes references inside code blocks", async () => {
    // Allocations: burner (N), code host (N+1), target (N+2).
    const burner = await createIssue({ title: "burn" });
    const targetNumber = burner.number + 2;
    await createIssue({ title: "code host", body: `\`\`\`\n#${targetNumber}\n\`\`\`` });
    const target = await createIssue({ title: "target 2" });
    expect(target.number).toBe(targetNumber);

    const backlinks = await api(`/api/graph/${target.number}/backlinks`);
    const links = backlinks.body as { source_title: string | null }[];
    expect(links.some((l) => l.source_title === "code host")).toBe(false);
  });
});

describe("wiki projection", () => {
  it("builds the tree and breadcrumbs", async () => {
    const root = await createIssue({ title: "wiki root", type: "wiki" });
    const section = await createIssue({ title: "section", type: "wiki" });
    const page = await createIssue({ title: "page", type: "wiki" });
    await post(`/api/graph/${section.number}/parent`, { parent_id: root.id });
    await post(`/api/graph/${page.number}/parent`, { parent_id: section.id });

    const tree = await api("/api/wiki/tree");
    const nodes = tree.body as {
      issue: { number: number };
      children: { issue: { number: number }; children: { issue: { number: number } }[] }[];
    }[];
    const rootNode = nodes.find((n) => n.issue.number === root.number)!;
    expect(rootNode.children.length).toBe(1);
    expect(rootNode.children[0]!.issue.number).toBe(section.number);
    expect(rootNode.children[0]!.children.length).toBe(1);
    expect(rootNode.children[0]!.children[0]!.issue.number).toBe(page.number);

    const crumbs = await api(`/api/wiki/${page.number}/breadcrumbs`);
    const list = crumbs.body as { number: number }[];
    expect(list.map((c) => c.number)).toEqual([root.number, section.number, page.number]);
  });
});
