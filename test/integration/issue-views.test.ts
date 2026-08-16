/** Saved Issues-page filter views: CRUD, validation, ordering, and audit. */
import { describe, expect, it } from "vitest";
import { api, patch, post, testEnv } from "./helpers";

const filters = {
  query: "needle",
  status: "closed",
  types: ["bug", "bug", "task"],
  labels: [" Alpha ", "alpha", "beta"],
};

describe("issue views", () => {
  it("creates normalized views and lists them in creation order", async () => {
    const first = await post("/api/issue-views", { name: "  Needs   triage  ", filters });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      name: "Needs triage",
      filters: { query: "needle", status: "closed", types: ["bug", "task"], labels: ["Alpha", "beta"] },
    });

    const second = await post("/api/issue-views", {
      name: "Documentation",
      filters: { query: "", status: null, types: ["wiki"], labels: [] },
    });
    expect(second.status).toBe(201);

    const list = await api("/api/issue-views");
    expect((list.body as { name: string }[]).map((view) => view.name)).toEqual(["Needs triage", "Documentation"]);
  });

  it("updates filters, renames, rejects duplicate names, and validates input", async () => {
    const a = await post("/api/issue-views", { name: "Alpha", filters: { status: "open" } });
    const b = await post("/api/issue-views", { name: "Beta", filters: {} });
    const aId = (a.body as { id: string }).id;
    const bId = (b.body as { id: string }).id;

    const updated = await patch(`/api/issue-views/${aId}`, {
      filters: { query: " changed ", status: null, types: ["wiki"], labels: ["docs"] },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ filters: { query: "changed", status: null, types: ["wiki"], labels: ["docs"] } });

    const renamed = await patch(`/api/issue-views/${aId}`, { name: "Renamed" });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: "Renamed" });

    expect((await patch(`/api/issue-views/${bId}`, { name: "renamed" })).status).toBe(409);
    expect((await post("/api/issue-views", { name: " ", filters: {} })).status).toBe(400);
    expect((await post("/api/issue-views", { name: "Invalid", filters: { status: "pending" } })).status).toBe(400);
    expect((await patch(`/api/issue-views/${aId}`, {})).status).toBe(400);
  });

  it("deletes views, returns not found, and records every mutation family", async () => {
    const created = await post("/api/issue-views", { name: "Temporary", filters: {} });
    const id = (created.body as { id: string }).id;
    await patch(`/api/issue-views/${id}`, { filters: { query: "x" } });
    await patch(`/api/issue-views/${id}`, { name: "Temporary renamed" });

    const removed = await api(`/api/issue-views/${id}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
    expect((await api(`/api/issue-views/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await patch("/api/issue-views/does-not-exist", { name: "Missing" })).status).toBe(404);

    const rows = await testEnv().DB.prepare(
      "SELECT action FROM audit_events WHERE entity_type = 'issue_view' AND entity_id = ? ORDER BY created_at ASC, id ASC",
    ).bind(id).all<{ action: string }>();
    expect(rows.results.map((row) => row.action).sort()).toEqual([
      "issue_view.create",
      "issue_view.delete",
      "issue_view.rename",
      "issue_view.update",
    ]);
  });
});
