/**
 * MCP tool input schemas (zod) plus a minimal zod→JSON-Schema converter for
 * the tools/list response. Only the subset of zod used here is supported.
 */
import { z } from "zod";
import { isValidTimezone } from "../shared/time";

export const issueRefSchema = z.union([
  z.string().uuid(),
  z.number().int().positive().transform((n) => String(n)),
  z.string().regex(/^\d+$/, "Issue id must be a UUID or a number"),
]);

const issueNumberSchema = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/).transform(Number),
]);
const isoDateSchema = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), "Must be an ISO date");
const timezoneSchema = z.string().refine(isValidTimezone, "Must be a valid IANA timezone");
const base64Schema = z.string().min(1).refine((value) => {
  const compact = value.replace(/\s/g, "");
  return compact.length % 4 !== 1 && /^[A-Za-z0-9+/_-]*={0,2}$/.test(compact);
}, "data must be valid base64");

export const getIssueSchema = z.union([
  z.object({ number: issueNumberSchema }),
  z.object({ issue_id: issueRefSchema }),
]);

export const searchIssuesSchema = z.object({
  query: z.string().min(1).max(200),
  type: z.enum(["task", "bug", "epic", "story", "decision", "finding", "incident", "learning", "wiki", "note"]).optional(),
  status: z.enum(["open", "closed"]).optional(),
  label: z.string().max(32).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const listLabelsSchema = z.object({});

export const getChildrenSchema = z.object({ issue_id: issueRefSchema });
export const getBacklinksSchema = z.object({ issue_id: issueRefSchema });

export const getTodaySchema = z.object({ timezone: timezoneSchema.optional() });
export const getUpcomingSchema = z.object({ timezone: timezoneSchema.optional() });

export const listAttachmentsSchema = z.object({ issue_id: issueRefSchema });

export const createIssueSchema = z.object({
  type: z.enum(["task", "bug", "epic", "story", "decision", "finding", "incident", "learning", "wiki", "note"]).optional(),
  title: z.string().trim().min(1).max(500),
  body: z.string().max(100_000).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
  labels: z.array(z.string().max(32)).max(20).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  scheduled_date: isoDateSchema.nullable().optional(),
  timezone: timezoneSchema.optional(),
  recurrence_rule: z.string().max(500).nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

export const updateIssueSchema = createIssueSchema
  .omit({})
  .extend({ issue_id: issueRefSchema, expected_version: z.number().int().positive() })
  .partial()
  .extend({
    issue_id: issueRefSchema,
    expected_version: z.number().int().positive(),
  })
  .refine(
    (input) => Object.entries(input).some(
      ([key, value]) => key !== "issue_id" && key !== "expected_version" && value !== undefined,
    ),
    { message: "At least one issue field must be provided" },
  );

export const closeIssueSchema = z.object({ issue_id: issueRefSchema });
export const completeTaskSchema = z.object({ issue_id: issueRefSchema });

export const addCommentSchema = z.object({
  issue_id: issueRefSchema,
  body: z.string().trim().min(1).max(50_000),
});

export const addChildSchema = z.object({
  parent_id: issueRefSchema,
  type: z.enum(["task", "bug", "epic", "story", "decision", "finding", "incident", "learning", "wiki", "note"]).optional(),
  title: z.string().trim().min(1).max(500),
  body: z.string().max(100_000).optional(),
});

export const linkIssuesSchema = z.object({
  source_id: issueRefSchema,
  target_id: issueRefSchema,
  type: z.enum(["related", "depends_on", "blocks", "supersedes", "duplicates"]),
});

const reminderIssueSchema = { issue_id: issueRefSchema, timezone: timezoneSchema.optional() };
export const createReminderSchema = z.union([
  z.object({ ...reminderIssueSchema, kind: z.literal("absolute"), trigger_at: isoDateSchema }),
  z.object({
    ...reminderIssueSchema,
    kind: z.literal("before_due"),
    offset_minutes: z.number().int().min(1).max(43_200),
  }),
  z.object({
    ...reminderIssueSchema,
    kind: z.literal("recurring"),
    recurrence_rule: z.string().min(1).max(500),
  }),
]);

export const updateReminderSchema = z.object({
  reminder_id: z.string().uuid(),
  status: z.enum(["active", "completed", "dismissed", "snoozed"]).optional(),
  snooze_until: isoDateSchema.optional(),
  trigger_at: isoDateSchema.optional(),
}).superRefine((input, ctx) => {
  if (input.status === undefined && input.snooze_until === undefined && input.trigger_at === undefined) {
    ctx.addIssue({ code: "custom", message: "At least one reminder field must be provided" });
  }
  if (input.status === "snoozed" && input.snooze_until === undefined) {
    ctx.addIssue({ code: "custom", message: "snooze_until is required when snoozing" });
  }
  if (input.snooze_until !== undefined && input.status !== "snoozed") {
    ctx.addIssue({ code: "custom", message: "snooze_until requires status snoozed" });
  }
  if (input.trigger_at !== undefined && input.status !== undefined && input.status !== "active") {
    ctx.addIssue({ code: "custom", message: "trigger_at cannot be combined with this status" });
  }
});

export const attachFileSchema = z.object({
  issue_id: issueRefSchema,
  filename: z.string().trim().min(1).max(255),
  content_type: z.string().max(255).optional(),
  data: base64Schema,
});

// ---------------------------------------------------------------------------
// Minimal zod → JSON Schema conversion (subset used above)
// ---------------------------------------------------------------------------

type ZodTypeLike = z.ZodTypeAny;

export function zodToJsonSchema(schema: ZodTypeLike): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodTypeLike>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!isOptional(value)) required.push(key);
    }
    return { type: "object", properties, required };
  }
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodNullable) return { ...zodToJsonSchema(schema.unwrap()), nullable: true };
  if (schema instanceof z.ZodDefault) return zodToJsonSchema(schema.removeDefault());
  if (schema instanceof z.ZodArray) return { type: "array", items: zodToJsonSchema(schema.element) };
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodLiteral) return { const: schema.value };
  if (schema instanceof z.ZodUnion) {
    const anyOf = schema.options.map((o: ZodTypeLike) => zodToJsonSchema(o));
    return { anyOf };
  }
  if (schema instanceof z.ZodEffects) {
    // transforms/refines: expose the inner type.
    const inner = schema.innerType();
    return zodToJsonSchema(inner as ZodTypeLike);
  }
  if (schema instanceof z.ZodPipeline) {
    return zodToJsonSchema((schema._def as { out: ZodTypeLike }).out);
  }
  if (schema instanceof z.ZodRecord) return { type: "object" };
  if (schema instanceof z.ZodUnknown) return {};
  return {};
}

function isOptional(schema: ZodTypeLike): boolean {
  return (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    (schema instanceof z.ZodNullable && isOptional(schema.unwrap()))
  );
}
