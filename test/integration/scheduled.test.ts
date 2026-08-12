/** Scheduled handlers invoked directly (Cron logic under the Workers runtime). */
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { createIssue, post, testEnv } from "./helpers";
import { runScheduledReminders } from "../../src/server/scheduled/reminders";
import { runScheduledAttachmentGc } from "../../src/server/scheduled/attachment-gc";

describe("scheduled handlers", () => {
  it("processes due reminders end-to-end from the cron entrypoint", async () => {
    const issue = await createIssue({ title: "cron reminder" });
    await post(`/api/reminders/issue/${issue.number}`, {
      kind: "absolute",
      trigger_at: new Date(Date.now() - 30_000).toISOString(),
    });

    const env = testEnv();
    const result = await runScheduledReminders(env);
    expect(result.delivered).toBe(1);

    const again = await runScheduledReminders(env);
    expect(again.delivered).toBe(0); // idempotent under duplicate firings

    const notifications = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications").first<{ n: number }>();
    expect(Number(notifications?.n ?? 0)).toBe(1);
  });

  it("runs attachment GC without touching live blobs", async () => {
    const issue = await createIssue({ title: "gc cron" });
    const form = new FormData();
    form.append("file", new File(["cron blob"], "cron.txt", { type: "text/plain" }));
    const res = await SELF.fetch(`https://nodebook.test/api/attachments/issue/${issue.number}`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(201);

    const env = testEnv();
    const result = await runScheduledAttachmentGc(env);
    expect(result.scanned).toBe(0); // nothing soft-deleted yet
    expect(result.deletedBlobs).toBe(0);

    const objects = await env.FILES.list({ prefix: "blobs/" });
    expect(objects.objects.length).toBe(1);
  });
});
