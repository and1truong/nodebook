import type { Ctx } from "../ctx";
import type {
  ChatActionDto, ChatActionType, ChatActivityDto, ChatConnectionDto, ChatConversationDetailDto, ChatConversationDto,
  ChatFolderDto, ChatMessageDto, ChatProvider, ChatSourceDto, ChatToolSupport,
} from "../../shared/contracts/chat";
import { ConflictError, NotFoundError } from "../../domain/errors";
import { encryptCredential } from "./chat-crypto";
import { mapInChunks, retryD1Read } from "./d1-retry";

export interface ChatConnectionSecret extends ChatConnectionDto { api_key_ciphertext: string; api_key_iv: string }

type Row = Record<string, unknown>;
const MESSAGE_HISTORY_LIMIT = 100;
// Keeps the number of bind parameters in the IN (...) hydration queries well
// under D1's statement/bind limits even when MESSAGE_HISTORY_LIMIT messages
// are hydrated in one request.
const CHUNK_SIZE = 50;
const text = (value: unknown) => String(value ?? "");

function connectionDto(row: Row): ChatConnectionDto {
  return {
    id: text(row.id), name: text(row.name), provider: text(row.provider) as ChatProvider,
    base_url: text(row.base_url), default_model: text(row.default_model), has_api_key: Boolean(row.api_key_ciphertext),
    tool_support: text(row.tool_support) as ChatToolSupport, created_at: text(row.created_at), updated_at: text(row.updated_at),
  };
}

function conversationDto(row: Row): ChatConversationDto {
  return {
    id: text(row.id), title: text(row.title), connection_id: text(row.connection_id),
    connection_name: text(row.connection_name), provider: text(row.provider) as ChatProvider, model: text(row.model),
    folder_id: row.folder_id == null ? null : text(row.folder_id), archived: Boolean(row.archived),
    generating: Boolean(row.generation_id), created_at: text(row.created_at), updated_at: text(row.updated_at),
  };
}

function folderDto(row: Row): ChatFolderDto {
  return { id: text(row.id), name: text(row.name), created_at: text(row.created_at), updated_at: text(row.updated_at) };
}

function parseJson(value: unknown): unknown {
  try { return JSON.parse(text(value)); } catch { return null; }
}

function actionDto(row: Row): ChatActionDto {
  return {
    id: text(row.id), action_type: text(row.action_type) as ChatActionType,
    payload: (parseJson(row.payload_json) ?? {}) as Record<string, unknown>,
    review: (parseJson(row.review_json) ?? {}) as Record<string, unknown>, status: text(row.status) as ChatActionDto["status"],
    result: row.result_json ? parseJson(row.result_json) : null, error_message: row.error_message == null ? null : text(row.error_message),
    created_at: text(row.created_at), updated_at: text(row.updated_at),
  };
}

function activityDto(row: Row): ChatActivityDto {
  return {
    id: text(row.id), tool_name: text(row.tool_name), label: text(row.label),
    input: row.input_json ? (parseJson(row.input_json) as Record<string, unknown>) : null,
    status: text(row.status) as ChatActivityDto["status"], created_at: text(row.created_at),
  };
}

function sourceDto(row: Row): ChatSourceDto {
  return { issue_id: text(row.issue_id), issue_number: Number(row.issue_number), title: text(row.title), rank: Number(row.rank) };
}

function messageDto(row: Row, sources: ChatSourceDto[], actions: ChatActionDto[], activities: ChatActivityDto[]): ChatMessageDto {
  return {
    id: text(row.id), conversation_id: text(row.conversation_id), role: text(row.role) as "user" | "assistant",
    content: text(row.content), status: text(row.status) as ChatMessageDto["status"],
    error_message: row.error_message == null ? null : text(row.error_message), sources, activities, actions,
    created_at: text(row.created_at), updated_at: text(row.updated_at),
  };
}

export async function listConnections(ctx: Ctx): Promise<ChatConnectionDto[]> {
  const result = await retryD1Read(() => ctx.env.DB.prepare("SELECT * FROM chat_connections ORDER BY name COLLATE NOCASE").all<Row>(), { label: "listConnections" });
  return result.results.map(connectionDto);
}

export async function getConnectionSecret(ctx: Ctx, id: string): Promise<ChatConnectionSecret> {
  const row = await retryD1Read(() => ctx.env.DB.prepare("SELECT * FROM chat_connections WHERE id = ?").bind(id).first<Row>(), { label: "getConnectionSecret" });
  if (!row) throw new NotFoundError("Chat connection not found");
  return { ...connectionDto(row), api_key_ciphertext: text(row.api_key_ciphertext), api_key_iv: text(row.api_key_iv) };
}

export async function createConnection(ctx: Ctx, input: { name: string; provider: ChatProvider; base_url: string; api_key: string; default_model: string }): Promise<ChatConnectionDto> {
  const id = crypto.randomUUID();
  const encrypted = await encryptCredential(ctx.env.CHAT_CREDENTIAL_KEY, id, input.api_key);
  const now = new Date().toISOString();
  const baseUrl = input.base_url.replace(/\/+$/, "");
  await ctx.env.DB.prepare(`INSERT INTO chat_connections
    (id, name, provider, base_url, api_key_ciphertext, api_key_iv, default_model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id, input.name, input.provider, baseUrl, encrypted.ciphertext, encrypted.iv, input.default_model, now, now,
    ).run();
  return connectionDto({ id, ...input, base_url: baseUrl, api_key_ciphertext: encrypted.ciphertext, tool_support: "unknown", created_at: now, updated_at: now });
}

export async function updateConnection(ctx: Ctx, id: string, input: Partial<{ name: string; provider: ChatProvider; base_url: string; api_key: string; default_model: string }>): Promise<ChatConnectionDto> {
  const existing = await getConnectionSecret(ctx, id);
  const encrypted = input.api_key === undefined ? { ciphertext: existing.api_key_ciphertext, iv: existing.api_key_iv } : await encryptCredential(ctx.env.CHAT_CREDENTIAL_KEY, id, input.api_key);
  const now = new Date().toISOString();
  const changingProvider = input.provider !== undefined && input.provider !== existing.provider;
  const result = await ctx.env.DB.prepare(`UPDATE chat_connections SET name = ?, provider = ?, base_url = ?, api_key_ciphertext = ?, api_key_iv = ?,
    default_model = ?, tool_support = CASE WHEN provider <> ? THEN 'unknown' ELSE tool_support END, updated_at = ? WHERE id = ?
    ${changingProvider ? "AND NOT EXISTS (SELECT 1 FROM chat_conversations WHERE connection_id = ?)" : ""}`).bind(
      input.name ?? existing.name, input.provider ?? existing.provider, (input.base_url ?? existing.base_url).replace(/\/+$/, ""),
      encrypted.ciphertext, encrypted.iv, input.default_model ?? existing.default_model, input.provider ?? existing.provider, now, id,
      ...(changingProvider ? [id] : []),
    ).run();
  if (changingProvider && !result.meta.changes) {
    throw new ConflictError("Connection provider cannot change while conversations reference it");
  }
  return connectionDto({ ...existing, ...input, api_key_ciphertext: encrypted.ciphertext, api_key_iv: encrypted.iv, updated_at: now });
}

export async function deleteConnection(ctx: Ctx, id: string): Promise<void> {
  const used = await ctx.env.DB.prepare("SELECT 1 AS used FROM chat_conversations WHERE connection_id = ? LIMIT 1").bind(id).first();
  if (used) throw new ConflictError("Connection is used by a conversation and cannot be deleted");
  const result = await ctx.env.DB.prepare("DELETE FROM chat_connections WHERE id = ?").bind(id).run();
  if (!result.meta.changes) throw new NotFoundError("Chat connection not found");
}

export async function setToolSupport(ctx: Ctx, id: string, value: ChatToolSupport): Promise<void> {
  await ctx.env.DB.prepare("UPDATE chat_connections SET tool_support = ?, updated_at = ? WHERE id = ?")
    .bind(value, new Date().toISOString(), id).run();
}

export async function listFolders(ctx: Ctx): Promise<ChatFolderDto[]> {
  const result = await retryD1Read(
    () => ctx.env.DB.prepare("SELECT * FROM chat_folders ORDER BY name COLLATE NOCASE, id").all<Row>(),
    { label: "listChatFolders" },
  );
  return result.results.map(folderDto);
}

export async function getFolder(ctx: Ctx, id: string): Promise<ChatFolderDto> {
  const row = await retryD1Read(
    () => ctx.env.DB.prepare("SELECT * FROM chat_folders WHERE id = ?").bind(id).first<Row>(),
    { label: "getChatFolder" },
  );
  if (!row) throw new NotFoundError("Chat folder not found");
  return folderDto(row);
}

export async function createFolder(ctx: Ctx, name: string): Promise<ChatFolderDto> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await ctx.env.DB.prepare(
    "INSERT INTO chat_folders (id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
  ).bind(id, name, now, now).run();
  if (!result.meta.changes) throw new ConflictError("A chat folder with that name already exists");
  return folderDto({ id, name, created_at: now, updated_at: now });
}

export async function updateFolder(ctx: Ctx, id: string, name: string): Promise<ChatFolderDto> {
  await getFolder(ctx, id);
  const now = new Date().toISOString();
  const result = await ctx.env.DB.prepare(`UPDATE chat_folders SET name = ?, updated_at = ? WHERE id = ?
    AND NOT EXISTS (SELECT 1 FROM chat_folders WHERE name = ? COLLATE NOCASE AND id <> ?)`)
    .bind(name, now, id, name, id).run();
  if (!result.meta.changes) throw new ConflictError("A chat folder with that name already exists");
  return getFolder(ctx, id);
}

export async function deleteFolder(ctx: Ctx, id: string): Promise<void> {
  const result = await ctx.env.DB.prepare("DELETE FROM chat_folders WHERE id = ?").bind(id).run();
  if (!result.meta.changes) throw new NotFoundError("Chat folder not found");
}

const CONVERSATION_SELECT = `SELECT c.*, x.name AS connection_name, x.provider AS provider
  FROM chat_conversations c JOIN chat_connections x ON x.id = c.connection_id`;

export async function listConversations(ctx: Ctx): Promise<ChatConversationDto[]> {
  await recoverExpiredLeases(ctx);
  const result = await retryD1Read(() => ctx.env.DB.prepare(`${CONVERSATION_SELECT} ORDER BY c.archived, c.updated_at DESC`).all<Row>(), { label: "listConversations" });
  return result.results.map(conversationDto);
}

export async function getConversation(ctx: Ctx, id: string): Promise<ChatConversationDto> {
  await recoverExpiredLeases(ctx);
  const row = await retryD1Read(() => ctx.env.DB.prepare(`${CONVERSATION_SELECT} WHERE c.id = ?`).bind(id).first<Row>(), { label: "getConversation" });
  if (!row) throw new NotFoundError("Conversation not found");
  return conversationDto(row);
}

export async function createConversation(ctx: Ctx, connectionId: string, model?: string, folderId?: string | null): Promise<ChatConversationDto> {
  const connection = await getConnectionSecret(ctx, connectionId);
  if (folderId) await getFolder(ctx, folderId);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await ctx.env.DB.prepare(`INSERT INTO chat_conversations (id, connection_id, model, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, connectionId, model ?? connection.default_model, folderId ?? null, now, now).run();
  return getConversation(ctx, id);
}

export async function updateConversation(ctx: Ctx, id: string, input: { title?: string; archived?: boolean; folder_id?: string | null }): Promise<ChatConversationDto> {
  const existing = await getConversation(ctx, id);
  if (input.folder_id) await getFolder(ctx, input.folder_id);
  await ctx.env.DB.prepare("UPDATE chat_conversations SET title = ?, archived = ?, folder_id = ?, updated_at = ? WHERE id = ?")
    .bind(
      input.title ?? existing.title,
      Number(input.archived ?? existing.archived),
      input.folder_id === undefined ? existing.folder_id : input.folder_id,
      new Date().toISOString(),
      id,
    ).run();
  return getConversation(ctx, id);
}

export async function deleteConversation(ctx: Ctx, id: string): Promise<void> {
  const result = await ctx.env.DB.prepare("DELETE FROM chat_conversations WHERE id = ? AND generation_id IS NULL").bind(id).run();
  if (!result.meta.changes) {
    const existing = await retryD1Read(() => ctx.env.DB.prepare("SELECT generation_id FROM chat_conversations WHERE id = ?").bind(id).first<Row>(), { label: "deleteConversation:check" });
    if (!existing) throw new NotFoundError("Conversation not found");
    throw new ConflictError("Stop the active response before deleting this conversation");
  }
}

export async function conversationDetail(ctx: Ctx, id: string): Promise<ChatConversationDetailDto> {
  const conversation = await getConversation(ctx, id);
  const messages = await listMessages(ctx, id);
  return { conversation, messages };
}

export async function listMessages(ctx: Ctx, conversationId: string): Promise<ChatMessageDto[]> {
  // rowid reflects the append order. UUID ordering is random and can place an
  // assistant response before the user message when both share a timestamp.
  const result = await retryD1Read(() => ctx.env.DB.prepare(`SELECT * FROM (
    SELECT rowid AS message_rowid, * FROM chat_messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT ?
  ) ORDER BY message_rowid`).bind(conversationId, MESSAGE_HISTORY_LIMIT).all<Row>(), { label: "listMessages:history" });
  if (result.results.length === 0) return [];

  const ids = result.results.map((row) => text(row.id));
  const [sources, actions, activities] = await loadMessageResources(ctx, ids);
  return result.results.map((row) => messageDto(
    row,
    sources.get(text(row.id)) ?? [],
    actions.get(text(row.id)) ?? [],
    activities.get(text(row.id)) ?? [],
  ));
}

/**
 * Batch-hydrates sources, actions, and activities for many message ids.
 * Queries are split into bounded chunks and each chunk is retried on
 * transient D1 failures, so a single conversation-detail load cannot trip
 * D1's bind-variable/statement limits or fail on a storage-service hiccup.
 * Rows are grouped by message id afterwards, so chunk ordering does not
 * affect the assembled DTOs.
 */
async function loadMessageResources(ctx: Ctx, ids: string[]): Promise<[Map<string, ChatSourceDto[]>, Map<string, ChatActionDto[]>, Map<string, ChatActivityDto[]>]> {
  const inClause = (slice: string[]) => slice.map(() => "?").join(", ");

  const sourcesQuery = (slice: string[]) => retryD1Read(() => ctx.env.DB.prepare(
    `SELECT s.message_id, s.issue_id, i.number AS issue_number, i.title, s.rank
      FROM chat_message_sources s JOIN issues i ON i.id = s.issue_id
      WHERE s.message_id IN (${inClause(slice)}) ORDER BY s.rank`).bind(...slice).all<Row>(),
    { label: "listMessages:sources" },
  );
  const actionsQuery = (slice: string[]) => retryD1Read(() => ctx.env.DB.prepare(
    `SELECT * FROM chat_actions WHERE message_id IN (${inClause(slice)}) ORDER BY rowid`).bind(...slice).all<Row>(),
    { label: "listMessages:actions" },
  );
  const activitiesQuery = (slice: string[]) => retryD1Read(() => ctx.env.DB.prepare(
    `SELECT * FROM chat_message_activities WHERE message_id IN (${inClause(slice)}) ORDER BY rowid`).bind(...slice).all<Row>(),
    { label: "listMessages:activities" },
  );

  const [sourceRows, actionRows, activityRows] = await Promise.all([
    mapInChunks(ids, CHUNK_SIZE, sourcesQuery).then((chunks) => chunks.flatMap((chunk) => chunk.results)),
    mapInChunks(ids, CHUNK_SIZE, actionsQuery).then((chunks) => chunks.flatMap((chunk) => chunk.results)),
    mapInChunks(ids, CHUNK_SIZE, activitiesQuery).then((chunks) => chunks.flatMap((chunk) => chunk.results)),
  ]);
  return [
    groupByMessage(sourceRows, sourceDto),
    groupByMessage(actionRows, actionDto),
    groupByMessage(activityRows, activityDto),
  ];
}

export async function hydrateMessage(ctx: Ctx, rowOrId: Row | string): Promise<ChatMessageDto> {
  const row = typeof rowOrId === "string" ? await ctx.env.DB.prepare("SELECT * FROM chat_messages WHERE id = ?").bind(rowOrId).first<Row>() : rowOrId;
  if (!row) throw new NotFoundError("Chat message not found");
  const [sources, actions, activities] = await Promise.all([
    retryD1Read(() => ctx.env.DB.prepare(`SELECT s.issue_id, i.number AS issue_number, i.title, s.rank FROM chat_message_sources s
      JOIN issues i ON i.id = s.issue_id WHERE s.message_id = ? ORDER BY s.rank`).bind(text(row.id)).all<Row>(), { label: "hydrateMessage:sources" }),
    retryD1Read(() => ctx.env.DB.prepare("SELECT * FROM chat_actions WHERE message_id = ? ORDER BY rowid").bind(text(row.id)).all<Row>(), { label: "hydrateMessage:actions" }),
    retryD1Read(() => ctx.env.DB.prepare("SELECT * FROM chat_message_activities WHERE message_id = ? ORDER BY rowid").bind(text(row.id)).all<Row>(), { label: "hydrateMessage:activities" }),
  ]);
  return messageDto(row, sources.results.map(sourceDto), actions.results.map(actionDto), activities.results.map(activityDto));
}

function groupByMessage<T>(rows: Row[], map: (row: Row) => T): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = text(row.message_id);
    const values = grouped.get(id) ?? [];
    values.push(map(row));
    grouped.set(id, values);
  }
  return grouped;
}

export async function acquireGeneration(ctx: Ctx, conversationId: string): Promise<{ generationId: string; userMessageId: string; assistantMessageId: string }> {
  await recoverExpiredLeases(ctx);
  const generationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await ctx.env.DB.prepare(`UPDATE chat_conversations SET generation_id = ?, generation_started_at = ?, updated_at = ?
    WHERE id = ? AND archived = 0 AND generation_id IS NULL`).bind(generationId, now, now, conversationId).run();
  if (!result.meta.changes) {
    const exists = await ctx.env.DB.prepare("SELECT id FROM chat_conversations WHERE id = ?").bind(conversationId).first();
    if (!exists) throw new NotFoundError("Conversation not found");
    throw new ConflictError("A response is already being generated for this conversation");
  }
  return { generationId, userMessageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID() };
}

export async function insertGenerationMessages(ctx: Ctx, ids: { userMessageId: string; assistantMessageId: string }, conversationId: string, content: string): Promise<void> {
  const now = new Date().toISOString();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("INSERT INTO chat_messages (id, conversation_id, role, content, status, created_at, updated_at) VALUES (?, ?, 'user', ?, 'complete', ?, ?)").bind(ids.userMessageId, conversationId, content, now, now),
    ctx.env.DB.prepare("INSERT INTO chat_messages (id, conversation_id, role, content, status, created_at, updated_at) VALUES (?, ?, 'assistant', '', 'streaming', ?, ?)").bind(ids.assistantMessageId, conversationId, now, now),
  ]);
}

export async function persistPartialMessage(ctx: Ctx, messageId: string, content: string): Promise<void> {
  await ctx.env.DB.prepare("UPDATE chat_messages SET content = ?, updated_at = ? WHERE id = ? AND status = 'streaming'")
    .bind(content, new Date().toISOString(), messageId).run();
}

export async function insertActivity(ctx: Ctx, messageId: string, input: { toolName: string; label: string; input: Record<string, unknown> }): Promise<ChatActivityDto> {
  const activity: ChatActivityDto = {
    id: crypto.randomUUID(), tool_name: input.toolName, label: input.label, input: input.input,
    status: "complete", created_at: new Date().toISOString(),
  };
  await ctx.env.DB.prepare(`INSERT INTO chat_message_activities (id, message_id, tool_name, label, input_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
      activity.id, messageId, activity.tool_name, activity.label, JSON.stringify(activity.input), activity.status, activity.created_at,
    ).run();
  return activity;
}

export async function finishGeneration(ctx: Ctx, input: { conversationId: string; generationId: string; messageId: string; content: string; status: "complete" | "stopped" | "error"; error?: string; sourceIds?: string[] }): Promise<ChatMessageDto> {
  const now = new Date().toISOString();
  const statements = [
    ctx.env.DB.prepare("UPDATE chat_messages SET content = ?, status = ?, error_message = ?, updated_at = ? WHERE id = ?")
      .bind(input.content, input.status, input.error ?? null, now, input.messageId),
    ctx.env.DB.prepare("UPDATE chat_conversations SET generation_id = NULL, generation_started_at = NULL, updated_at = ? WHERE id = ? AND generation_id = ?")
      .bind(now, input.conversationId, input.generationId),
  ];
  for (const [rank, issueId] of (input.sourceIds ?? []).entries()) statements.push(
    ctx.env.DB.prepare("INSERT OR IGNORE INTO chat_message_sources (message_id, issue_id, rank) VALUES (?, ?, ?)").bind(input.messageId, issueId, rank),
  );
  await ctx.env.DB.batch(statements);
  return hydrateMessage(ctx, input.messageId);
}

export async function insertAction(ctx: Ctx, messageId: string, actionType: ChatActionType, payload: Record<string, unknown>, review: Record<string, unknown>): Promise<ChatActionDto> {
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await ctx.env.DB.prepare(`INSERT INTO chat_actions (id, message_id, action_type, payload_json, review_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, messageId, actionType, JSON.stringify(payload), JSON.stringify(review), now, now).run();
  const row = await ctx.env.DB.prepare("SELECT * FROM chat_actions WHERE id = ?").bind(id).first<Row>();
  return actionDto(row!);
}

export async function claimAction(ctx: Ctx, id: string): Promise<ChatActionDto | null> {
  const now = new Date().toISOString();
  const row = await ctx.env.DB.prepare("UPDATE chat_actions SET status = 'executing', updated_at = ? WHERE id = ? AND status = 'pending' RETURNING *")
    .bind(now, id).first<Row>();
  return row ? actionDto(row) : null;
}

export async function getAction(ctx: Ctx, id: string): Promise<ChatActionDto> {
  const row = await ctx.env.DB.prepare("SELECT * FROM chat_actions WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new NotFoundError("Chat action not found");
  return actionDto(row);
}

export async function settleAction(ctx: Ctx, id: string, status: "succeeded" | "failed", result?: unknown, error?: string): Promise<ChatActionDto> {
  await ctx.env.DB.prepare("UPDATE chat_actions SET status = ?, result_json = ?, error_message = ?, updated_at = ? WHERE id = ? AND status = 'executing'")
    .bind(status, result === undefined ? null : JSON.stringify(result), error ?? null, new Date().toISOString(), id).run();
  return getAction(ctx, id);
}

export async function rejectAction(ctx: Ctx, id: string): Promise<ChatActionDto> {
  const now = new Date().toISOString();
  await ctx.env.DB.prepare("UPDATE chat_actions SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'pending'").bind(now, id).run();
  return getAction(ctx, id);
}

async function recoverExpiredLeases(ctx: Ctx): Promise<void> {
  const cutoff = new Date(Date.now() - 6 * 60_000).toISOString();
  // Idempotent maintenance updates: re-running converges to the same state,
  // so a transient failure can be retried safely.
  await retryD1Read(() => ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE chat_messages SET status = 'error', error_message = 'Generation lease expired', updated_at = ?
      WHERE status = 'streaming' AND conversation_id IN (SELECT id FROM chat_conversations WHERE generation_started_at < ?)`)
      .bind(new Date().toISOString(), cutoff),
    ctx.env.DB.prepare("UPDATE chat_conversations SET generation_id = NULL, generation_started_at = NULL WHERE generation_started_at < ?").bind(cutoff),
  ]), { label: "recoverExpiredLeases" });
}
