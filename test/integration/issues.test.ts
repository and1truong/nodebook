/** Issue CRUD, state transitions, numbering, comments, history. */
import { describe, expect, it } from "vitest";
import { api, createIssue, patch, post } from "./helpers";

describe("issue lifecycle", () => {
  it("creates an issue with sequential numbers and validates input", async () => {
    const a = await createIssue({ title: "First", type: "task" });
    const b = await createIssue({ title: "Second", type: "wiki" });
    expect(b.number).toBe(a.number + 1);
    expect(a.status).toBe("open");
    expect(a.type).toBe("task");

    const bad = await post("/api/issues", { title: "   " });
    expect(bad.status).toBe(400);

    const badType = await post("/api/issues", { title: "x", type: "not-a-type" });
    expect(badType.status).toBe(400);
  });

  it("allocates unique numbers under concurrent creates", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => createIssue({ title: "concurrent" })),
    );
    const numbers = results.map((r) => r.number);
    expect(new Set(numbers).size).toBe(12);
    expect(Math.max(...numbers) - Math.min(...numbers)).toBe(11);
  });

  it("supports all issue types and planning fields", async () => {
    for (const type of ["task", "bug", "epic", "story", "decision", "finding", "incident", "learning", "wiki", "note"]) {
      const issue = await createIssue({ title: `type ${type}`, type });
      expect(issue.type).toBe(type);
    }
    const planned = await createIssue({
      title: "planned",
      due_date: "2025-12-31",
      start_date: "2025-12-01",
      scheduled_date: "2025-12-15T10:00:00.000Z",
      priority: "high",
      labels: ["alpha", "beta"],
    });
    expect(planned.due_date).toBe("2025-12-31");
    expect(planned.priority).toBe("high");
    expect(planned.labels).toEqual(["alpha", "beta"]);
  });

  it("normalizes labels and rejects invalid dates", async () => {
    const issue = await createIssue({ title: "labels", labels: ["  Alpha  ", "alpha", "beta"] });
    expect(issue.labels).toEqual(["Alpha", "beta"]);
    const bad = await post("/api/issues", { title: "x", due_date: "12/31/2025" });
    expect(bad.status).toBe(400);
  });

  it("closes and reopens with legal state transitions", async () => {
    const issue = await createIssue({ title: "states" });
    const closed = await post(`/api/issues/${issue.number}/close`, {});
    expect(closed.status).toBe(200);
    expect((closed.body as { status: string }).status).toBe("closed");

    const again = await post(`/api/issues/${issue.number}/close`, {});
    expect(again.status).toBe(409);

    const reopened = await post(`/api/issues/${issue.number}/reopen`, {});
    expect((reopened.body as { status: string }).status).toBe("open");

    const reopenAgain = await post(`/api/issues/${issue.number}/reopen`, {});
    expect(reopenAgain.status).toBe(409);
  });

  it("updates fields and records before/after audit payloads", async () => {
    const issue = await createIssue({ title: "before", body: "original" });
    const res = await patch(`/api/issues/${issue.number}`, { title: "after", body: "edited", labels: ["x"] });
    expect(res.status).toBe(200);
    const updated = res.body as { title: string; body: string; labels: string[] };
    expect(updated.title).toBe("after");
    expect(updated.labels).toEqual(["x"]);

    const history = (await api(`/api/issues/${issue.number}/history`)).body as {
      action: string;
      before: { title: string } | null;
      after: { title: string } | null;
    }[];
    const update = history.find((e) => e.action === "issue.update")!;
    expect(update.before?.title).toBe("before");
    expect(update.after?.title).toBe("after");
  });

  it("looks up issues by number and by uuid", async () => {
    const issue = await createIssue({ title: "refs" });
    const byNumber = await api(`/api/issues/${issue.number}`);
    expect((byNumber.body as { id: string }).id).toBe(issue.id);
    const byId = await api(`/api/issues/${issue.id}`);
    expect((byId.body as { number: number }).number).toBe(issue.number);
    const missing = await api("/api/issues/999999");
    expect(missing.status).toBe(404);
  });

  it("clamps non-numeric list params instead of 500ing", async () => {
    const bad = await api("/api/issues?limit=abc&offset=xyz");
    expect(bad.status).toBe(200);
    const res = bad.body as { issues: unknown[] };
    expect(Array.isArray(res.issues)).toBe(true);
  });

  it("filters the issue list by type/status/label", async () => {
    await createIssue({ title: "bug one", type: "bug", labels: ["tagged"] });
    await createIssue({ title: "task one", type: "task" });
    const bugs = await api("/api/issues?type=bug");
    expect((bugs.body as { issues: { type: string }[] }).issues.every((i) => i.type === "bug")).toBe(true);
    const tagged = await api("/api/issues?label=tagged");
    expect((tagged.body as { issues: { labels: string[] }[] }).issues.every((i) => i.labels.includes("tagged"))).toBe(true);
    const closed = await api("/api/issues?status=closed");
    expect((closed.body as { issues: unknown[] }).issues).toHaveLength(0);
  });
});

describe("comments", () => {
  it("adds, lists, and edits comments with history", async () => {
    const issue = await createIssue({ title: "comments" });
    const created = await post(`/api/issues/${issue.number}/comments`, { body: "First comment" });
    expect(created.status).toBe(201);

    const empty = await post(`/api/issues/${issue.number}/comments`, { body: "   " });
    expect(empty.status).toBe(400);

    const list = await api(`/api/issues/${issue.number}/comments`);
    const comments = list.body as { id: string; body: string; edited_at: string | null }[];
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toBe("First comment");
    expect(comments[0]!.edited_at).toBeNull();

    const edited = await patch(`/api/comments/${comments[0]!.id}`, { body: "Edited comment" });
    expect(edited.status).toBe(200);
    expect((edited.body as { body: string; edited_at: string }).body).toBe("Edited comment");
    expect((edited.body as { edited_at: string }).edited_at).toBeTruthy();

    const history = (await api(`/api/issues/${issue.number}/history`)).body as { action: string }[];
    expect(history.some((e) => e.action === "comment.create")).toBe(true);
    expect(history.some((e) => e.action === "comment.update")).toBe(true);
  });
});
