/** Graph routes: hierarchy, relationships, backlinks, wiki. */
import { Hono } from "hono";
import type { AppEnv } from "./helpers";
import * as graphService from "../services/graph-service";
import { relationshipCreateSchema, setParentSchema } from "../../shared/contracts/issues";
import { ValidationError } from "../../domain/errors";

export const graphRoutes = new Hono<AppEnv>();

// Wiki projection (mounted at /api/wiki)
export const wikiRoutes = new Hono<AppEnv>();

wikiRoutes.get("/tree", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const tree = await graphService.getWikiTree(ctx);
  return c.json(tree);
});

wikiRoutes.get("/:ref/breadcrumbs", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const issue = await graphService.getIssueByRefOrThrow(ctx, c.req.param("ref"));
  const crumbs = await graphService.getBreadcrumbs(ctx, issue.id);
  return c.json(crumbs);
});

graphRoutes.post("/:ref/parent", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const input = setParentSchema.parse(body);
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const issue = await graphService.getIssueByRefOrThrow(ctx, c.req.param("ref"));
  await graphService.setParent(ctx, issue.id, input.parent_id);
  return c.json({ ok: true });
});

graphRoutes.get("/:ref/children", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const issue = await graphService.getIssueByRefOrThrow(ctx, c.req.param("ref"));
  const children = await graphService.getChildrenDtos(ctx, issue.id);
  return c.json(children);
});

graphRoutes.get("/:ref/sub-issues", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const issue = await graphService.getIssueByRefOrThrow(ctx, c.req.param("ref"));
  const children = await graphService.getDirectSubIssues(ctx, issue.id);
  return c.json(children);
});

graphRoutes.get("/:ref/sub-issue-candidates", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const issue = await graphService.getIssueByRefOrThrow(ctx, c.req.param("ref"));
  const q = c.req.query("q") ?? "";
  const limitParam = Number(c.req.query("limit") ?? 20);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20;
  const candidates = await graphService.getSubIssueCandidates(ctx, issue.id, q, limit);
  return c.json(candidates);
});

graphRoutes.get("/:ref/backlinks", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const issue = await graphService.getIssueByRefOrThrow(ctx, c.req.param("ref"));
  const backlinks = await graphService.getBacklinkDtos(ctx, issue.id);
  return c.json(backlinks);
});

graphRoutes.get("/:ref/relationships", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const issue = await graphService.getIssueByRefOrThrow(ctx, c.req.param("ref"));
  const relationships = await graphService.getRelationshipsDtos(ctx, issue.id);
  return c.json(relationships);
});

graphRoutes.get("/:ref/related", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const issue = await graphService.getIssueByRefOrThrow(ctx, c.req.param("ref"));
  const related = await graphService.getRelatedIssueDtos(ctx, issue.id);
  return c.json(related);
});

graphRoutes.post("/:ref/relationships", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const input = relationshipCreateSchema.parse(body);
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const issue = await graphService.getIssueByRefOrThrow(ctx, c.req.param("ref"));
  const relationship = await graphService.addRelationship(ctx, issue.id, input.target_id, input.type);
  return c.json(relationship, 201);
});

graphRoutes.delete("/relationships/:id", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  await graphService.removeRelationship(ctx, c.req.param("id"));
  return c.json({ ok: true });
});
