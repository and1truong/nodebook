/** Issue routes: CRUD, state transitions, completion, history. */
import { Hono } from "hono";
import type { AppEnv } from "./helpers";
import * as issueService from "../services/issue-service";
import { addComment, listComments } from "../services/comment-service";
import { commentCreateSchema, issueCreateSchema, issueUpdateSchema } from "../../shared/contracts/issues";
import { ValidationError } from "../../domain/errors";

export const issuesRoutes = new Hono<AppEnv>();

function ctx(c: { env: AppEnv["Bindings"]; get: (k: "actor") => AppEnv["Variables"]["actor"] }) {
  return { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
}

issuesRoutes.get("/", async (c) => {
  const type = c.req.query("type");
  const status = c.req.query("status");
  const label = c.req.query("label");
  const query = c.req.query("q");
  const limitParam = Number(c.req.query("limit") ?? 100);
  const offsetParam = Number(c.req.query("offset") ?? 0);
  // Clamp instead of trusting raw query params (non-numeric input → defaults,
  // never NaN bind values).
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 100;
  const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;
  const result = await issueService.listIssues(ctx(c), {
    type,
    status,
    label,
    query,
    limit,
    offset,
  });
  return c.json(result);
});

issuesRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const input = issueCreateSchema.parse(body);
  const issue = await issueService.createIssue(ctx(c), {
    type: input.type,
    title: input.title,
    body: input.body,
    priority: input.priority ?? null,
    labels: input.labels,
    start_date: input.start_date ?? null,
    due_date: input.due_date ?? null,
    scheduled_date: input.scheduled_date ?? null,
    timezone: input.timezone,
    recurrence_rule: input.recurrence_rule ?? null,
    parent_id: input.parent_id ?? null,
  });
  return c.json(issue, 201);
});

issuesRoutes.get("/me", async (c) => {
  const actor = c.get("actor");
  return c.json({ email: actor.id, actor_type: actor.type });
});

issuesRoutes.get("/:ref", async (c) => {
  const issue = await issueService.getIssue(ctx(c), c.req.param("ref"));
  return c.json(issue);
});

issuesRoutes.get("/:ref/comments", async (c) => {
  const comments = await listComments(ctx(c), c.req.param("ref"));
  return c.json(comments);
});

issuesRoutes.post("/:ref/comments", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const input = commentCreateSchema.parse(body);
  const comment = await addComment(ctx(c), c.req.param("ref"), input.body);
  return c.json(comment, 201);
});

issuesRoutes.patch("/:ref", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const input = issueUpdateSchema.parse(body);
  const issue = await issueService.updateIssue(ctx(c), c.req.param("ref"), input);
  return c.json(issue);
});

issuesRoutes.post("/:ref/close", async (c) => {
  const issue = await issueService.closeIssue(ctx(c), c.req.param("ref"));
  return c.json(issue);
});

issuesRoutes.post("/:ref/reopen", async (c) => {
  const issue = await issueService.reopenIssue(ctx(c), c.req.param("ref"));
  return c.json(issue);
});

issuesRoutes.post("/:ref/complete", async (c) => {
  const issue = await issueService.completeTask(ctx(c), c.req.param("ref"));
  return c.json(issue);
});

issuesRoutes.get("/:ref/history", async (c) => {
  const history = await issueService.getIssueHistory(ctx(c), c.req.param("ref"));
  return c.json(history);
});
