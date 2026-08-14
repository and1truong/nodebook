/** Issue CRUD, state transitions, numbering, comments, history. */
import { describe, expect, it } from "vitest";
import { api, createIssue, patch, post } from "./helpers";
import { civilDateTimeString } from "../../src/shared/time";

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

  it("rejects nonexistent calendar dates", async () => {
    for (const field of ["start_date", "due_date"]) {
      const bad = await post("/api/issues", { title: "x", [field]: "2025-02-31" });
      expect(bad.status).toBe(400);
    }
    const nonLeap = await post("/api/issues", { title: "x", due_date: "2025-02-29" });
    expect(nonLeap.status).toBe(400);
    const leap = await post("/api/issues", { title: "leap", due_date: "2024-02-29" });
    expect(leap.status).toBe(201);
  });

  it("round-trips scheduled_date instants into the issue timezone", async () => {
    const issue = await createIssue({
      title: "scheduled tz",
      timezone: "America/Los_Angeles",
      scheduled_date: "2025-08-12T18:00:00.000Z",
    });
    // The stored instant renders as the wall clock of the issue's timezone
    // (the same conversion the editor's datetime-local input uses), so an
    // untouched edit field submits back the identical instant.
    expect(civilDateTimeString(new Date(issue.scheduled_date as string), issue.timezone as string)).toBe("2025-08-12T11:00");
  });

  it("closes and reopens with legal state transitions", async () => {
    const issue = await createIssue({ title: "states" });
    const closed = await post(`/api/issues/${issue.number}/close`, {});
    expect(closed.status).toBe(200);
    expect((closed.body as { status: string; version: number })).toMatchObject({
      status: "closed",
      version: Number(issue.version) + 1,
    });

    const again = await post(`/api/issues/${issue.number}/close`, {});
    expect(again.status).toBe(409);

    const reopened = await post(`/api/issues/${issue.number}/reopen`, {});
    expect((reopened.body as { status: string; version: number })).toMatchObject({
      status: "open",
      version: Number(issue.version) + 2,
    });

    const reopenAgain = await post(`/api/issues/${issue.number}/reopen`, {});
    expect(reopenAgain.status).toBe(409);
  });

  it("updates fields and records before/after audit payloads", async () => {
    const issue = await createIssue({ title: "before", body: "original" });
    const res = await patch(`/api/issues/${issue.number}`, {
      expected_version: issue.version,
      title: "after",
      body: "edited",
      labels: ["x"],
    });
    expect(res.status).toBe(200);
    const updated = res.body as { title: string; body: string; labels: string[]; version: number };
    expect(updated.title).toBe("after");
    expect(updated.labels).toEqual(["x"]);
    expect(updated.version).toBe(Number(issue.version) + 1);

    const history = (await api(`/api/issues/${issue.number}/history`)).body as {
      action: string;
      before: { title: string } | null;
      after: { title: string } | null;
    }[];
    const update = history.find((e) => e.action === "issue.update")!;
    expect(update.before?.title).toBe("before");
    expect(update.after?.title).toBe("after");
  });

  it("rejects stale edits before changing fields, labels, references, or audit history", async () => {
    const target = await createIssue({ title: "conflict target" });
    const issue = await createIssue({ title: "original", body: "original body", labels: ["original"] });

    const winner = await patch(`/api/issues/${issue.number}`, {
      expected_version: issue.version,
      title: "winner",
    });
    expect(winner.status).toBe(200);

    const stale = await patch(`/api/issues/${issue.number}`, {
      expected_version: issue.version,
      body: `stale reference #${target.number}`,
      labels: ["stale"],
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: {
        code: "version_conflict",
        details: { expected_version: issue.version, current_version: Number(issue.version) + 1 },
      },
    });

    const current = (await api(`/api/issues/${issue.number}`)).body as {
      title: string;
      body: string;
      labels: string[];
      backlink_count: number;
      version: number;
    };
    expect(current).toMatchObject({
      title: "winner",
      body: "original body",
      labels: ["original"],
      version: Number(issue.version) + 1,
    });

    const history = (await api(`/api/issues/${issue.number}/history`)).body as { action: string }[];
    expect(history.filter((event) => event.action === "issue.update")).toHaveLength(1);
    const backlinks = (await api(`/api/graph/${target.number}/backlinks`)).body as unknown[];
    expect(backlinks).toHaveLength(0);
  });

  it("allows only one concurrent edit for the same expected version", async () => {
    const issue = await createIssue({ title: "race" });
    const [a, b] = await Promise.all([
      patch(`/api/issues/${issue.number}`, { expected_version: issue.version, title: "racer a" }),
      patch(`/api/issues/${issue.number}`, { expected_version: issue.version, title: "racer b" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const current = (await api(`/api/issues/${issue.number}`)).body as { title: string; version: number };
    expect(["racer a", "racer b"]).toContain(current.title);
    expect(current.version).toBe(Number(issue.version) + 1);
  });

  it("requires an optimistic-lock version for edits", async () => {
    const issue = await createIssue({ title: "needs version" });
    const missing = await patch(`/api/issues/${issue.number}`, { title: "not accepted" });
    expect(missing.status).toBe(400);
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

  it("supports multiple types, multiple labels, and keyword filters", async () => {
    const marker = `multi-${crypto.randomUUID().slice(0, 8)}`;
    const red = `${marker}-red`;
    const blue = `${marker}-blue`;
    await createIssue({ title: `${marker} bug needle`, body: "first searchable body", type: "bug", labels: [red] });
    await createIssue({ title: `${marker} wiki`, body: "second searchable needle", type: "wiki", labels: [blue] });
    await createIssue({ title: `${marker} task needle`, type: "task", labels: [`${marker}-other`] });

    const types = await api(`/api/issues?q=${marker}&type=bug&type=wiki`);
    const typedBody = types.body as { issues: { type: string }[]; total: number };
    expect(typedBody.issues.map((issue) => issue.type).sort()).toEqual(["bug", "wiki"]);
    expect(typedBody.total).toBe(2);

    const labels = await api(`/api/issues?q=${marker}&label=${red}&label=${blue}`);
    const labelledBody = labels.body as { issues: { labels: string[] }[]; total: number };
    expect(labelledBody.issues).toHaveLength(2);
    expect(labelledBody.issues.every((issue) => issue.labels.includes(red) || issue.labels.includes(blue))).toBe(true);
    expect(labelledBody.total).toBe(2);

    const keyword = await api(`/api/issues?q=${encodeURIComponent("second searchable needle")}`);
    expect((keyword.body as { issues: { type: string }[] }).issues.map((issue) => issue.type)).toContain("wiki");
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
