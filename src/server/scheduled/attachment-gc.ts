/** Scheduled handler: attachment garbage collection (daily Cron Trigger). */
import type { Env } from "../../env";
import { systemCtx } from "../ctx";
import { runAttachmentGc } from "../services/attachment-service";

export async function runScheduledAttachmentGc(env: Env, now?: Date): Promise<{ scanned: number; deletedRows: number; deletedBlobs: number }> {
  const ctx = systemCtx(env, "system:cron:attachment-gc");
  return runAttachmentGc(ctx, now);
}
