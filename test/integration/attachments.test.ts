/** Private attachments: upload, dedupe, auth, ranges, soft delete, GC. */
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { api, createIssue, testEnv } from "./helpers";
import { systemCtx } from "../../src/server/ctx";
import { runAttachmentGc } from "../../src/server/services/attachment-service";

function makeFile(name: string, type: string, content: string): File {
  return new File([content], name, { type });
}

async function upload(issueRef: number | string, file: File): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.append("file", file);
  const res = await SELF.fetch(`https://nodebook.test/api/attachments/issue/${issueRef}`, { method: "POST", body: form });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* noop */
  }
  return { status: res.status, body };
}

describe("attachments", () => {
  it("uploads for issues and comments, computing checksums", async () => {
    const issue = await createIssue({ title: "attach me" });
    const res = await upload(issue.number, makeFile("hello.txt", "text/plain", "hello world"));
    expect(res.status).toBe(201);
    const attachment = res.body as { id: string; checksum: string; size: number; owner_type: string; url: string };
    expect(attachment.checksum).toHaveLength(64);
    expect(attachment.size).toBe(11);
    expect(attachment.owner_type).toBe("issue");
    expect(attachment.url).toBe(`/api/attachments/${attachment.id}/content`);

    const meta = await api(`/api/attachments/${attachment.id}`);
    expect((meta.body as { filename: string }).filename).toBe("hello.txt");
  });

  it("deduplicates R2 blobs by checksum", async () => {
    const a = await createIssue({ title: "dup a" });
    const b = await createIssue({ title: "dup b" });
    const file = makeFile("same.bin", "application/octet-stream", "identical bytes");

    const ra = await upload(a.number, file);
    const rb = await upload(b.number, file);
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    const checksumA = (ra.body as { checksum: string }).checksum;
    const checksumB = (rb.body as { checksum: string }).checksum;
    expect(checksumA).toBe(checksumB);

    // One R2 object, two attachment rows.
    const env = testEnv();
    const objects = await env.FILES.list({ prefix: "blobs/" });
    expect(objects.objects.length).toBe(1);
  });

  it("enforces the upload size limit", async () => {
    const issue = await createIssue({ title: "big file" });
    const big = makeFile("big.bin", "application/octet-stream", "x".repeat(26 * 1024 * 1024));
    const res = await upload(issue.number, big);
    expect(res.status).toBe(413);
  });

  it("rejects uploads to missing issues", async () => {
    const res = await upload("00000000-0000-0000-0000-000000000000", makeFile("x.txt", "text/plain", "x"));
    expect(res.status).toBe(404);
  });

  it("serves content inline for preview types and download for unsafe types", async () => {
    const issue = await createIssue({ title: "content" });
    const png = await upload(issue.number, makeFile("pic.png", "image/png", "PNGDATA"));
    const content = await api(`/api/attachments/${(png.body as { id: string }).id}/content`);
    expect(content.status).toBe(200);
    const disposition = (await SELF.fetch(`https://nodebook.test/api/attachments/${(png.body as { id: string }).id}/content`))
      .headers.get("content-disposition");
    expect(disposition).toContain("inline");

    const exe = await upload(issue.number, makeFile("tool.exe", "application/x-msdownload", "MZ"));
    const exeRes = await SELF.fetch(`https://nodebook.test/api/attachments/${(exe.body as { id: string }).id}/content`);
    expect(exeRes.headers.get("content-disposition")).toContain("attachment");
  });

  it("supports byte ranges", async () => {
    const issue = await createIssue({ title: "ranges" });
    const file = makeFile("data.txt", "text/plain", "0123456789");
    const res = await upload(issue.number, file);
    const id = (res.body as { id: string }).id;

    const range = await SELF.fetch(`https://nodebook.test/api/attachments/${id}/content`, {
      headers: { Range: "bytes=2-5" },
    });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe("2345");
    expect(range.headers.get("content-range")).toBe("bytes 2-5/10");

    const suffix = await SELF.fetch(`https://nodebook.test/api/attachments/${id}/content`, {
      headers: { Range: "bytes=-3" },
    });
    expect(await suffix.text()).toBe("789");
  });

  it("lists attachments per owner and soft-deletes", async () => {
    const issue = await createIssue({ title: "soft delete" });
    const res = await upload(issue.number, makeFile("keep.txt", "text/plain", "keep"));
    const id = (res.body as { id: string }).id;

    const del = await api(`/api/attachments/${id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const after = await api(`/api/attachments/${id}`);
    expect(after.status).toBe(404);
    const content = await SELF.fetch(`https://nodebook.test/api/attachments/${id}/content`);
    expect(content.status).toBe(404);
  });

  it("garbage-collects unreferenced blobs after the grace period", async () => {
    const issue = await createIssue({ title: "gc" });
    const res = await upload(issue.number, makeFile("gc.txt", "text/plain", "gc me"));
    const attachment = res.body as { id: string; checksum: string };

    // Delete softly, then run GC with a clock past the grace period.
    await api(`/api/attachments/${attachment.id}`, { method: "DELETE" });

    const env = testEnv();
    const ctx = systemCtx(env);
    const result = await runAttachmentGc(ctx, new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(result.deletedRows).toBe(1);
    expect(result.deletedBlobs).toBe(1);

    const objects = await env.FILES.list({ prefix: "blobs/" });
    expect(objects.objects.length).toBe(0);
  });

  it("never deletes blobs still referenced by active attachments", async () => {
    const a = await createIssue({ title: "shared a" });
    const b = await createIssue({ title: "shared b" });
    const file = makeFile("shared.bin", "application/octet-stream", "shared bytes");
    const ra = await upload(a.number, file);
    const rb = await upload(b.number, file);
    const idA = (ra.body as { id: string }).id;
    const idB = (rb.body as { id: string }).id;

    // Soft-delete one attachment; the blob is still referenced by the other.
    await api(`/api/attachments/${idA}`, { method: "DELETE" });
    const env = testEnv();
    const ctx = systemCtx(env);
    const result = await runAttachmentGc(ctx, new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(result.deletedRows).toBe(0);
    expect(result.deletedBlobs).toBe(0);

    // The surviving attachment still serves content.
    const content = await SELF.fetch(`https://nodebook.test/api/attachments/${idB}/content`);
    expect(content.status).toBe(200);
  });
});
