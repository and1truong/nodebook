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

  it("enforces graph invariants on PATCH parent_id (no direct column write)", async () => {
    const a = await createIssue({ title: "cycle a" });
    const b = await createIssue({ title: "cycle b" });
    await post(`/api/graph/${b.number}/parent`, { parent_id: a.id });

    // PATCHing b as a's parent would create a two-node cycle: rejected.
    const cycle = await patch(`/api/issues/${a.number}`, { parent_id: b.id });
    expect(cycle.status).toBe(409);

    // Self-parent via PATCH is rejected too.
    const self = await patch(`/api/issues/${a.number}`, { parent_id: a.id });
    expect(self.status).toBe(400);

    // Valid reparenting through PATCH still works.
    const c = await createIssue({ title: "cycle c" });
    const ok = await patch(`/api/issues/${b.number}`, { parent_id: c.id });
    expect(ok.status).toBe(200);
    expect((ok.body as { parent_number: number | null }).parent_number).toBe(c.number);
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

describe("sub-issues tree", () => {
  it("returns 404 for a missing root", async () => {
    const res = await api("/api/graph/999999/sub-issues");
    expect(res.status).toBe(404);
  });

  it("returns an empty array for roots without children", async () => {
    const root = await createIssue({ title: "leaf" });
    const res = await api(`/api/graph/${root.number}/sub-issues`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns one hierarchy level per request with counts", async () => {
    const root = await createIssue({ title: "sub root" });
    const childA = await createIssue({ title: "sub a" });
    const childB = await createIssue({ title: "sub b" });
    const grandchild = await createIssue({ title: "grandchild" });
    const unrelated = await createIssue({ title: "unrelated" });

    await post(`/api/graph/${childA.number}/parent`, { parent_id: root.id });
    await post(`/api/graph/${childB.number}/parent`, { parent_id: root.id });
    await post(`/api/graph/${grandchild.number}/parent`, { parent_id: childB.id });
    await post(`/api/issues/${childA.number}/close`, {});

    // Root request: direct children only, ordered by number, with status and
    // each row's own direct-child counts. Grandchildren are NOT included.
    const res = await api(`/api/graph/${root.number}/sub-issues`);
    expect(res.status).toBe(200);
    const rows = res.body as {
      id: string;
      number: number;
      title: string;
      status: string;
      parent_id: string | null;
      child_count: number;
      closed_child_count: number;
    }[];

    expect(rows).toHaveLength(2);
    expect(rows[0]!.number).toBe(childA.number);
    expect(rows[0]!.status).toBe("closed");
    expect(rows[0]!.parent_id).toBe(root.id);
    expect(rows[0]!.child_count).toBe(0);
    expect(rows[1]!.number).toBe(childB.number);
    expect(rows[1]!.status).toBe("open");
    // Counts describe unloaded descendants: childB has one open grandchild.
    expect(rows[1]!.child_count).toBe(1);
    expect(rows[1]!.closed_child_count).toBe(0);
    // The response is flat — no recursive children anywhere.
    expect(rows.every((r) => !("children" in r))).toBe(true);

    // Unrelated issues never appear.
    expect(rows.some((r) => r.number === unrelated.number)).toBe(false);

    // A child request returns only that issue's direct children.
    const childRes = await api(`/api/graph/${childB.number}/sub-issues`);
    expect(childRes.status).toBe(200);
    const childRows = childRes.body as { number: number; child_count: number }[];
    expect(childRows).toHaveLength(1);
    expect(childRows[0]!.number).toBe(grandchild.number);
    expect(childRows[0]!.child_count).toBe(0);
  });

  it("excludes descendants from link candidates server-side", async () => {
    const root = await createIssue({ title: "candidate root" });
    const child = await createIssue({ title: "candidate child" });
    const grandchild = await createIssue({ title: "candidate grandchild" });
    const sibling = await createIssue({ title: "candidate sibling" });
    const orphan = await createIssue({ title: "candidate orphan" });

    await post(`/api/graph/${child.number}/parent`, { parent_id: root.id });
    await post(`/api/graph/${grandchild.number}/parent`, { parent_id: child.id });

    // Missing root → 404.
    const missing = await api("/api/graph/999999/sub-issue-candidates");
    expect(missing.status).toBe(404);

    // Recent candidates: root, its descendants, and itself never appear,
    // even though the client never loaded the subtree.
    const recent = await api(`/api/graph/${root.number}/sub-issue-candidates?limit=100`);
    expect(recent.status).toBe(200);
    const recentIds = (recent.body as { id: string; number: number }[]).map((i) => i.id);
    expect(recentIds).not.toContain(root.id);
    expect(recentIds).not.toContain(child.id);
    expect(recentIds).not.toContain(grandchild.id);
    expect(recentIds).toContain(sibling.id);
    expect(recentIds).toContain(orphan.id);

    // LIKE search also excludes the whole subtree.
    const search = await api(`/api/graph/${root.number}/sub-issue-candidates?q=candidate&limit=100`);
    const searchNumbers = (search.body as { number: number }[]).map((i) => i.number);
    expect(searchNumbers).toContain(sibling.number);
    expect(searchNumbers).toContain(orphan.number);
    expect(searchNumbers).not.toContain(child.number);
    expect(searchNumbers).not.toContain(grandchild.number);

    // Exact #number lookups: eligible issues resolve, descendants do not.
    const exact = await api(`/api/graph/${root.number}/sub-issue-candidates?q=${orphan.number}`);
    const exactNumbers = (exact.body as { number: number }[]).map((i) => i.number);
    expect(exactNumbers).toContain(orphan.number);

    const exactDescendant = await api(`/api/graph/${root.number}/sub-issue-candidates?q=${grandchild.number}`);
    const descendantNumbers = (exactDescendant.body as { number: number }[]).map((i) => i.number);
    expect(descendantNumbers).not.toContain(grandchild.number);

    // Candidates are full IssueDtos (parent_number included for the move badge).
    const orphanRow = (exact.body as { number: number; parent_number: number | null }[]).find(
      (i) => i.number === orphan.number,
    );
    expect(orphanRow).toBeDefined();
    expect(orphanRow!.parent_number).toBeNull();
  });

  it("treats % and _ in candidate queries literally (LIKE escaping)", async () => {
    const root = await createIssue({ title: "escape root" });
    const pct = await createIssue({ title: "pct 100% done" });
    const anyChar = await createIssue({ title: "pct 100X done" });
    const underscore = await createIssue({ title: "pct 100_ years" });

    // Unescaped, `100%` would match any title containing "100", and `100_`
    // any title where "100" is followed by a single character.
    const pctSearch = await api(`/api/graph/${root.number}/sub-issue-candidates?q=100%25&limit=100`);
    const pctNumbers = (pctSearch.body as { number: number }[]).map((i) => i.number);
    expect(pctNumbers).toContain(pct.number);
    expect(pctNumbers).not.toContain(anyChar.number);
    expect(pctNumbers).not.toContain(underscore.number);

    const underscoreSearch = await api(`/api/graph/${root.number}/sub-issue-candidates?q=100_&limit=100`);
    const underscoreNumbers = (underscoreSearch.body as { number: number }[]).map((i) => i.number);
    expect(underscoreNumbers).toContain(underscore.number);
    expect(underscoreNumbers).not.toContain(pct.number);
    expect(underscoreNumbers).not.toContain(anyChar.number);
  });

  it("reparents an issue and preserves its descendants", async () => {
    const oldParent = await createIssue({ title: "old parent" });
    const newParent = await createIssue({ title: "new parent" });
    const moving = await createIssue({ title: "moving issue" });
    const descendant = await createIssue({ title: "kept descendant" });
    await post(`/api/graph/${moving.number}/parent`, { parent_id: oldParent.id });
    await post(`/api/graph/${descendant.number}/parent`, { parent_id: moving.id });

    const before = await api(`/api/graph/${oldParent.number}/sub-issues`);
    expect((before.body as unknown[]).length).toBe(1);

    // Linking an issue under another parent moves it; nothing else changes.
    const moved = await post(`/api/graph/${moving.number}/parent`, { parent_id: newParent.id });
    expect(moved.status).toBe(200);

    // It disappears from the old parent's subtree…
    const afterOld = await api(`/api/graph/${oldParent.number}/sub-issues`);
    expect(afterOld.body).toEqual([]);

    // …and appears under the new parent as a direct child whose own counts
    // reflect the preserved descendant (loaded lazily on demand).
    const afterNew = await api(`/api/graph/${newParent.number}/sub-issues`);
    const rows = afterNew.body as { number: number; child_count: number; closed_child_count: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.number).toBe(moving.number);
    expect(rows[0]!.child_count).toBe(1);
    expect(rows[0]!.closed_child_count).toBe(0);

    // The descendant is still there, one level down.
    const descendantLevel = await api(`/api/graph/${moving.number}/sub-issues`);
    const descendantRows = descendantLevel.body as { number: number }[];
    expect(descendantRows).toHaveLength(1);
    expect(descendantRows[0]!.number).toBe(descendant.number);

    // The move is audited as issue.set_parent with before/after payloads.
    const history = await api(`/api/issues/${moving.number}/history`);
    const events = history.body as {
      action: string;
      before: { parent_id: string | null };
      after: { parent_id: string | null };
    }[];
    expect(
      events.some(
        (e) =>
          e.action === "issue.set_parent" &&
          e.before.parent_id === oldParent.id &&
          e.after.parent_id === newParent.id,
      ),
    ).toBe(true);
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
