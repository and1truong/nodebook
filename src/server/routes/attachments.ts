/** Attachment routes: multipart upload, metadata, private content, soft delete. */
import { Hono } from "hono";
import type { AppEnv } from "./helpers";
import * as attachmentService from "../services/attachment-service";
import { getIssueByRef } from "../repositories/issues";
import { getCommentById } from "../repositories/issues";
import { NotFoundError, ValidationError } from "../../domain/errors";
import { uploadLimitBytes } from "../../env";

export const attachmentsRoutes = new Hono<AppEnv>();

function ctx(c: { env: AppEnv["Bindings"]; get: (k: "actor") => AppEnv["Variables"]["actor"] }) {
  return { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
}

attachmentsRoutes.post("/issue/:ref", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Missing multipart file field");
  const issue = await getIssueByRef(c.env.DB, c.req.param("ref"));
  if (!issue) throw new NotFoundError("Issue not found");
  const attachment = await attachmentService.uploadAttachment(ctx(c), {
    ownerType: "issue",
    ownerId: issue.id,
    filename: file.name || "file",
    contentType: file.type || "application/octet-stream",
    bytes: await file.arrayBuffer(),
    maxBytes: uploadLimitBytes(c.env),
  });
  return c.json(attachment, 201);
});

attachmentsRoutes.post("/comment/:id", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Missing multipart file field");
  const comment = await getCommentById(c.env.DB, c.req.param("id"));
  if (!comment) throw new NotFoundError("Comment not found");
  const attachment = await attachmentService.uploadAttachment(ctx(c), {
    ownerType: "comment",
    ownerId: comment.id,
    filename: file.name || "file",
    contentType: file.type || "application/octet-stream",
    bytes: await file.arrayBuffer(),
    maxBytes: uploadLimitBytes(c.env),
  });
  return c.json(attachment, 201);
});

attachmentsRoutes.get("/issue/:ref", async (c) => {
  const issue = await getIssueByRef(c.env.DB, c.req.param("ref"));
  if (!issue) throw new NotFoundError("Issue not found");
  return c.json(await attachmentService.listAttachments(ctx(c), "issue", issue.id));
});

attachmentsRoutes.get("/comment/:id", async (c) => {
  const comment = await getCommentById(c.env.DB, c.req.param("id"));
  if (!comment) throw new NotFoundError("Comment not found");
  return c.json(await attachmentService.listAttachments(ctx(c), "comment", comment.id));
});

attachmentsRoutes.get("/:id", async (c) => {
  return c.json(await attachmentService.getAttachment(ctx(c), c.req.param("id")));
});

attachmentsRoutes.get("/:id/content", async (c) => {
  const result = await attachmentService.getAttachmentContent(
    ctx(c),
    c.req.param("id"),
    c.req.header("range") ?? null,
  );
  if (!result) throw new NotFoundError("Attachment not found");
  return new Response(result.body, { status: result.status, headers: result.headers });
});

attachmentsRoutes.delete("/:id", async (c) => {
  await attachmentService.softDeleteAttachment(ctx(c), c.req.param("id"));
  return c.json({ ok: true });
});
