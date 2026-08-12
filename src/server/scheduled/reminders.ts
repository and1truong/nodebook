/** Scheduled handler: process due reminders (one-minute Cron Trigger). */
import type { Env } from "../../env";
import { systemCtx } from "../ctx";
import { processDueReminders } from "../services/reminder-service";

export async function runScheduledReminders(env: Env, now?: Date): Promise<{ claimed: number; delivered: number }> {
  const ctx = systemCtx(env, "system:cron:reminders");
  return processDueReminders(ctx, now);
}
