import { z } from "zod";

export const CHAT_PROVIDERS = ["openai", "anthropic"] as const;
export type ChatProvider = (typeof CHAT_PROVIDERS)[number];
export type ChatToolSupport = "unknown" | "supported" | "unsupported";
export type ChatMessageStatus = "streaming" | "complete" | "stopped" | "error";
export type ChatActionStatus = "pending" | "executing" | "succeeded" | "rejected" | "failed";

const httpsUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Provider URL must use HTTPS and must not contain credentials");

export const chatConnectionCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.enum(CHAT_PROVIDERS),
  base_url: httpsUrl,
  api_key: z.string().trim().min(1).max(10_000),
  default_model: z.string().trim().min(1).max(200),
});

export const chatConnectionUpdateSchema = chatConnectionCreateSchema.partial().refine(
  (input) => Object.values(input).some((value) => value !== undefined),
  "At least one connection field must be provided",
);

export const chatConversationCreateSchema = z.object({
  connection_id: z.string().uuid(),
  model: z.string().trim().min(1).max(200).optional(),
  folder_id: z.string().uuid().nullable().optional(),
});

export const chatConversationUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  archived: z.boolean().optional(),
  folder_id: z.string().uuid().nullable().optional(),
}).refine(
  (input) => input.title !== undefined || input.archived !== undefined || input.folder_id !== undefined,
  "At least one conversation field must be provided",
);

export const chatFolderCreateSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const chatFolderUpdateSchema = chatFolderCreateSchema;

export const chatMessageCreateSchema = z.object({ content: z.string().trim().min(1).max(50_000) });

export const CHAT_ACTION_TYPES = [
  "issue.create", "issue.edit", "issue.complete", "issue.close", "issue.reopen",
  "comment.add", "comment.edit", "parent.set", "relationship.add", "relationship.remove",
  "reminder.create", "reminder.update", "saved_view.create", "saved_view.update", "saved_view.delete",
] as const;
export type ChatActionType = (typeof CHAT_ACTION_TYPES)[number];

export const chatToolInputSchema = z.object({
  action_type: z.enum(CHAT_ACTION_TYPES),
  payload: z.record(z.unknown()),
});

export interface ChatConnectionDto {
  id: string; name: string; provider: ChatProvider; base_url: string; default_model: string;
  has_api_key: boolean; tool_support: ChatToolSupport; created_at: string; updated_at: string;
}

export interface ChatFolderDto { id: string; name: string; created_at: string; updated_at: string }

export interface ChatConversationDto {
  id: string; title: string; connection_id: string; connection_name: string; provider: ChatProvider;
  model: string; folder_id: string | null; archived: boolean; generating: boolean; created_at: string; updated_at: string;
}

export interface ChatSourceDto { issue_id: string; issue_number: number; title: string; rank: number }

export interface ChatActivityDto {
  id: string; tool_name: string; label: string; input: Record<string, unknown> | null;
  status: "complete" | "error"; created_at: string;
}

export interface ChatActionDto {
  id: string; action_type: ChatActionType; payload: Record<string, unknown>; review: Record<string, unknown>;
  status: ChatActionStatus; result: unknown; error_message: string | null; created_at: string; updated_at: string;
}

export interface ChatMessageDto {
  id: string; conversation_id: string; role: "user" | "assistant"; content: string;
  status: ChatMessageStatus; error_message: string | null; sources: ChatSourceDto[]; activities: ChatActivityDto[];
  actions: ChatActionDto[]; created_at: string; updated_at: string;
}

export interface ChatConversationDetailDto { conversation: ChatConversationDto; messages: ChatMessageDto[] }

export type ChatStreamEvent =
  | { type: "start"; user_message_id: string; assistant_message_id: string }
  | { type: "delta"; delta: string }
  | { type: "activity"; activity: ChatActivityDto }
  | { type: "proposal"; proposal: ChatActionDto }
  | { type: "done"; message: ChatMessageDto }
  | { type: "error"; message: string; code?: string };
