/** Reminder routes. */
import { Hono } from "hono";
import type { AppEnv } from "./helpers";
import * as reminderService from "../services/reminder-service";
import { reminderCreateSchema, reminderUpdateSchema } from "../../shared/contracts/issues";
import { ValidationError } from "../../domain/errors";

export const remindersRoutes = new Hono<AppEnv>();

remindersRoutes.get("/issue/:ref", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json(await reminderService.listReminders(ctx, c.req.param("ref")));
});

remindersRoutes.post("/issue/:ref", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const input = reminderCreateSchema.parse(body);
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const reminder = await reminderService.createReminder(ctx, c.req.param("ref"), {
    kind: input.kind,
    triggerAt: input.kind === "absolute" ? input.trigger_at : undefined,
    offsetMinutes: input.kind === "before_due" ? input.offset_minutes : undefined,
    recurrenceRule: input.kind === "recurring" ? input.recurrence_rule : undefined,
    timezone: input.kind === "recurring" ? input.timezone : undefined,
  });
  return c.json(reminder, 201);
});

remindersRoutes.get("/:id", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json(await reminderService.getReminder(ctx, c.req.param("id")));
});

remindersRoutes.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new ValidationError("Invalid JSON body");
  });
  const input = reminderUpdateSchema.parse(body);
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  return c.json(
    await reminderService.updateReminder(ctx, c.req.param("id"), {
      status: input.status,
      snooze_until: input.snooze_until,
      trigger_at: input.trigger_at,
    }),
  );
});

/**
 * Ops/testing endpoint: run the same due-reminder processing the Cron Trigger
 * performs. Access-protected like all /api routes.
 */
remindersRoutes.post("/process", async (c) => {
  const ctx = { env: c.env, actor: c.get("actor"), requestId: crypto.randomUUID() };
  const result = await reminderService.processDueReminders(ctx);
  return c.json(result);
});
