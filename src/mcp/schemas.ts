/**
 * MCP tool input schemas (zod) plus a minimal zod→JSON-Schema converter for
 * the tools/list response. Only the subset of zod used here is supported.
 */
import { z } from "zod";

export const issueRefSchema = z.union([
  z.string().uuid(),
  z.number().int().positive().transform((n) => String(n)),
  z.string().regex(/^\d+$/, "Issue id must be a UUID or a number").transform(Number).pipe(z.number().int().positive()),
]);

const isoDateSchema = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), "Must be an ISO date");

export const getIssueSchema = z.object({
  number: z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]),
});

export const searchIssuesSchema = z.object({
  query: z.string().min(1).max(200),
  type: z.enum(["task", "bug", "epic", "story", "decision", "finding", "incident", "learning", "wiki", "note"]).optional(),
  status: z.enum(["open", "closed"]).optional(),
  label: z.string().max(32).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const getChildrenSchema = z.object({ issue_id: issueRefSchema });
export const getBacklinksSchema = z.object({ issue_id: issueRefSchema });

export const getTodaySchema = z.object({ timezone: z.string().optional() });
export const getUpcomingSchema = z.object({ timezone: z.string().optional() });

export const listAttachmentsSchema = z.object({ issue_id: issueRefSchema });

export const createIssueSchema = z.object({
  type: z.enum(["task", "bug", "epic", "story", "decision", "finding", "incident", "learning", "wiki", "note"]).optional(),
  title: z.string().min(1).max(500),
  body: z.string().max(100_000).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
  labels: z.array(z.string().max(32)).max(20).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  scheduled_date: z.string().nullable().optional(),
  timezone: z.string().optional(),
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
  body: z.string().min(1).max(50_000),
});

export const addChildSchema = z.object({
  parent_id: z.string().uuid(),
  type: z.enum(["task", "bug", "epic", "story", "decision", "finding", "incident", "learning", "wiki", "note"]).optional(),
  title: z.string().min(1).max(500),
  body: z.string().max(100_000).optional(),
});

export const linkIssuesSchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  type: z.enum(["related", "depends_on", "blocks", "supersedes", "duplicates"]),
});

export const createReminderSchema = z.object({
  issue_id: issueRefSchema,
  kind: z.enum(["absolute", "before_due", "recurring"]),
  trigger_at: isoDateSchema.optional(),
  offset_minutes: z.number().int().min(1).max(43_200).optional(),
  recurrence_rule: z.string().max(500).optional(),
  timezone: z.string().optional(),
});

export const updateReminderSchema = z.object({
  reminder_id: z.string().uuid(),
  status: z.enum(["active", "completed", "dismissed", "snoozed"]).optional(),
  snooze_until: isoDateSchema.optional(),
  trigger_at: isoDateSchema.optional(),
});

export const attachFileSchema = z.object({
  issue_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  content_type: z.string().max(255).optional(),
  data: z.string().min(1),
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
