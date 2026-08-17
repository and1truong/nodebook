import { useEffect, useRef, useState } from "react";
import { Archive, ArrowLeft, MessageSquarePlus, Plus, Send, Settings2, Square, Trash2 } from "lucide-react";
import { api, streamChatMessage } from "../api";
import type { ChatActionDto, ChatConnectionDto, ChatConversationDetailDto, ChatConversationDto, ChatMessageDto } from "../../shared/contracts/chat";
import { Markdown } from "../components/Markdown";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { cn } from "@/lib/utils";

export function ChatPage({ conversationId, navigate }: { conversationId?: string; navigate: (to: string) => void }) {
  const [connections, setConnections] = useState<ChatConnectionDto[]>([]);
  const [conversations, setConversations] = useState<ChatConversationDto[]>([]);
  const [detail, setDetail] = useState<ChatConversationDetailDto | null>(null);
  const [draft, setDraft] = useState(""); const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false); const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const reloadLists = async () => {
    const [nextConnections, nextConversations] = await Promise.all([api.chatConnections(), api.chatConversations()]);
    setConnections(nextConnections); setConversations(nextConversations);
  };
  const reloadDetail = async () => { if (conversationId) setDetail(await api.chatConversation(conversationId)); else setDetail(null); };
  useEffect(() => { void reloadLists().catch(showError); }, []);
  useEffect(() => { void reloadDetail().catch(showError); }, [conversationId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [detail?.messages, sending]);

  const send = async () => {
    const content = draft.trim(); if (!content || !conversationId || sending) return;
    setDraft(""); setError(null); setSending(true);
    const controller = new AbortController(); abortRef.current = controller;
    const now = new Date().toISOString();
    const user: ChatMessageDto = { id: crypto.randomUUID(), conversation_id: conversationId, role: "user", content, status: "complete", error_message: null, sources: [], actions: [], created_at: now, updated_at: now };
    const assistant: ChatMessageDto = { ...user, id: crypto.randomUUID(), role: "assistant", content: "", status: "streaming" };
    setDetail((current) => current ? { ...current, messages: [...current.messages, user, assistant] } : current);
    try {
      await streamChatMessage(conversationId, content, controller.signal, (event) => {
        if (event.type === "delta") setDetail((current) => current ? { ...current, messages: current.messages.map((message, index) => index === current.messages.length - 1 ? { ...message, content: message.content + event.delta } : message) } : current);
        if (event.type === "proposal") setDetail((current) => current ? { ...current, messages: current.messages.map((message, index) => index === current.messages.length - 1 ? { ...message, actions: [...message.actions, event.proposal] } : message) } : current);
        if (event.type === "done") setDetail((current) => current ? { ...current, messages: [...current.messages.slice(0, -1), event.message] } : current);
        if (event.type === "error") setError(event.message);
      });
    } catch (cause) { if (!controller.signal.aborted) showError(cause); }
    finally { abortRef.current = null; setSending(false); await Promise.all([reloadDetail(), reloadLists()]).catch(showError); }
  };

  const updateAction = async (action: ChatActionDto, confirm: boolean) => {
    try {
      const updated = confirm ? await api.confirmChatAction(action.id) : await api.rejectChatAction(action.id);
      setDetail((current) => current ? { ...current, messages: current.messages.map((message) => ({ ...message, actions: message.actions.map((candidate) => candidate.id === action.id ? updated : candidate) })) } : current);
    } catch (cause) { showError(cause); }
  };

  const showError = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Chat request failed");
  return (
    <div className="flex h-[calc(100vh-123px)] min-h-[480px] overflow-hidden rounded-lg border bg-card md:h-[calc(100vh-107px)]">
      <aside className={cn("w-full shrink-0 border-r md:block md:w-72", conversationId && "hidden")}>
        <div className="flex h-14 items-center gap-2 border-b px-3">
          <NewConversationDialog connections={connections} onCreated={(conversation) => { void reloadLists(); navigate(`/chat/${conversation.id}`); }} />
          <ConnectionDialog connections={connections} onChanged={() => void reloadLists()} />
        </div>
        <div className="h-[calc(100%-56px)] overflow-y-auto p-2">
          {conversations.map((conversation) => <button key={conversation.id} className={cn("mb-1 w-full rounded-md px-3 py-2 text-left hover:bg-accent", conversation.id === conversationId && "bg-accent")} onClick={() => navigate(`/chat/${conversation.id}`)}>
            <span className="block truncate text-sm font-medium">{conversation.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{conversation.model}{conversation.archived ? " · archived" : ""}</span>
          </button>)}
          {!conversations.length && <p className="p-4 text-center text-sm text-muted-foreground">Create a connection, then start a conversation.</p>}
        </div>
      </aside>
      <section className={cn("hidden min-w-0 flex-1 flex-col md:flex", conversationId && "flex")}>
        {!detail ? <div className="m-auto max-w-md p-6 text-center text-muted-foreground">Select a conversation or start a new one.</div> : <>
          <header className="flex h-14 items-center gap-2 border-b px-3">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => navigate("/chat")}><ArrowLeft className="size-4" /></Button>
            <Input className="h-8 max-w-md border-transparent font-semibold hover:border-input focus:border-input" value={detail.conversation.title} onChange={(event) => setDetail({ ...detail, conversation: { ...detail.conversation, title: event.target.value } })} onBlur={() => void api.updateChatConversation(detail.conversation.id, { title: detail.conversation.title }).then(reloadLists).catch(showError)} />
            <span className="hidden text-xs text-muted-foreground sm:inline">{detail.conversation.connection_name} · {detail.conversation.model}</span>
            <Button className="ml-auto" variant="ghost" size="icon" title={detail.conversation.archived ? "Restore" : "Archive"} onClick={() => void api.updateChatConversation(detail.conversation.id, { archived: !detail.conversation.archived }).then(async () => { await reloadLists(); await reloadDetail(); }).catch(showError)}><Archive className="size-4" /></Button>
            <Button variant="ghost" size="icon" title="Delete" onClick={() => { if (confirm("Permanently delete this conversation?")) void api.deleteChatConversation(detail.conversation.id).then(() => { navigate("/chat"); void reloadLists(); }).catch(showError); }}><Trash2 className="size-4" /></Button>
          </header>
          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-8">
            <div className="mx-auto max-w-3xl space-y-5">
              {detail.messages.map((message) => <div key={message.id} className={cn("flex", message.role === "user" && "justify-end")}>
                <div className={cn("max-w-[90%] rounded-xl px-4 py-3", message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  {message.role === "assistant" ? <Markdown source={message.content || (message.status === "streaming" ? "…" : "")} /> : <p className="whitespace-pre-wrap text-sm">{message.content}</p>}
                  {message.sources.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{message.sources.map((source) => <a key={source.issue_id} href={`/issues/${source.issue_number}`} className="rounded-full border bg-background px-2 py-1 text-xs">#{source.issue_number} {source.title}</a>)}</div>}
                  {message.actions.map((action) => <ActionCard key={action.id} action={action} onUpdate={updateAction} />)}
                  {message.status === "error" && <p className="mt-2 text-xs text-destructive">{message.error_message}</p>}
                </div>
              </div>)}
              <div ref={bottomRef} />
            </div>
          </div>
          <div className="border-t p-3"><div className="mx-auto flex max-w-3xl items-end gap-2">
            <Textarea value={draft} disabled={sending || detail.conversation.archived} placeholder="Ask about NodeBook or request a change…" className="min-h-11 resize-none" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
            {sending ? <Button variant="destructive" onClick={() => abortRef.current?.abort()}><Square className="mr-2 size-4" />Stop</Button> : <Button disabled={!draft.trim() || detail.conversation.archived} onClick={() => void send()}><Send className="mr-2 size-4" />Send</Button>}
          </div>{error && <p className="mx-auto mt-2 max-w-3xl text-sm text-destructive">{error}</p>}</div>
        </>}
      </section>
    </div>
  );
}

function ActionCard({ action, onUpdate }: { action: ChatActionDto; onUpdate: (action: ChatActionDto, confirm: boolean) => Promise<void> }) {
  return <div className="mt-3 rounded-lg border bg-background p-3 text-sm"><p className="font-semibold">{String(action.review.operation ?? action.action_type)}</p><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(action.review, null, 2)}</pre>{action.status === "pending" ? <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => void onUpdate(action, true)}>Confirm</Button><Button size="sm" variant="outline" onClick={() => void onUpdate(action, false)}>Dismiss</Button></div> : <p className={cn("mt-2 text-xs", action.status === "failed" && "text-destructive")}>{action.status}{action.error_message ? `: ${action.error_message}` : ""}</p>}</div>;
}

function NewConversationDialog({ connections, onCreated }: { connections: ChatConnectionDto[]; onCreated: (conversation: ChatConversationDto) => void }) {
  const [open, setOpen] = useState(false); const [connectionId, setConnectionId] = useState(""); const [model, setModel] = useState("");
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button className="flex-1"><MessageSquarePlus className="mr-2 size-4" />New chat</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>New conversation</DialogTitle><DialogDescription>The provider connection and model are pinned to this conversation.</DialogDescription></DialogHeader><Label>Connection</Label><Select value={connectionId} onValueChange={(id) => { setConnectionId(id); setModel(connections.find((item) => item.id === id)?.default_model ?? ""); }}><SelectTrigger><SelectValue placeholder="Select connection" /></SelectTrigger><SelectContent>{connections.map((connection) => <SelectItem key={connection.id} value={connection.id}>{connection.name}</SelectItem>)}</SelectContent></Select><Label>Model</Label><Input value={model} onChange={(event) => setModel(event.target.value)} /><DialogFooter><Button disabled={!connectionId || !model.trim()} onClick={() => void api.createChatConversation(connectionId, model).then((conversation) => { setOpen(false); onCreated(conversation); })}>Create</Button></DialogFooter></DialogContent></Dialog>;
}

function ConnectionDialog({ connections, onChanged }: { connections: ChatConnectionDto[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false); const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [name, setName] = useState(""); const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1"); const [apiKey, setApiKey] = useState(""); const [model, setModel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null); const [formError, setFormError] = useState<string | null>(null);
  const edit = (connection: ChatConnectionDto) => { setEditingId(connection.id); setName(connection.name); setProvider(connection.provider); setBaseUrl(connection.base_url); setModel(connection.default_model); setApiKey(""); setFormError(null); };
  const reset = () => { setEditingId(null); setName(""); setProvider("openai"); setBaseUrl("https://api.openai.com/v1"); setModel(""); setApiKey(""); setFormError(null); };
  const save = async () => {
    try {
      if (editingId) await api.updateChatConnection(editingId, { name, provider, base_url: baseUrl, default_model: model, ...(apiKey ? { api_key: apiKey } : {}) });
      else await api.createChatConnection({ name, provider, base_url: baseUrl, api_key: apiKey, default_model: model });
      reset(); onChanged();
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Connection update failed"); }
  };
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}><DialogTrigger asChild><Button variant="outline" size="icon" title="Manage connections"><Settings2 className="size-4" /></Button></DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Provider connections</DialogTitle><DialogDescription>API keys are encrypted before storage and are never returned to the browser.</DialogDescription></DialogHeader>
    {connections.length > 0 && <div className="space-y-2">{connections.map((connection) => <div key={connection.id} className="flex items-center gap-2 rounded-md border p-2"><button className="min-w-0 flex-1 text-left" onClick={() => edit(connection)}><span className="block truncate text-sm font-medium">{connection.name}</span><span className="block truncate text-xs text-muted-foreground">{connection.provider} · {connection.default_model}</span></button><Button variant="ghost" size="icon" title="Delete connection" onClick={() => void api.deleteChatConnection(connection.id).then(onChanged).catch((cause) => setFormError(cause instanceof Error ? cause.message : "Delete failed"))}><Trash2 className="size-4" /></Button></div>)}</div>}
    <div className="grid gap-3 border-t pt-4"><h3 className="text-sm font-semibold">{editingId ? "Edit connection" : "Add connection"}</h3><Label>Name</Label><Input value={name} onChange={(event) => setName(event.target.value)} /><Label>Provider</Label><Select value={provider} onValueChange={(value) => { const next = value as "openai" | "anthropic"; setProvider(next); if (!editingId) setBaseUrl(next === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com/v1"); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="openai">OpenAI-compatible</SelectItem><SelectItem value="anthropic">Anthropic</SelectItem></SelectContent></Select><Label>HTTPS base URL</Label><Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /><Label>API key {editingId && <span className="font-normal text-muted-foreground">(leave blank to preserve)</span>}</Label><Input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /><Label>Default model</Label><Input value={model} onChange={(event) => setModel(event.target.value)} />{formError && <p className="text-sm text-destructive">{formError}</p>}</div>
    <DialogFooter>{editingId && <Button variant="outline" onClick={reset}>Cancel edit</Button>}<Button disabled={!name.trim() || (!editingId && !apiKey) || !model.trim()} onClick={() => void save()}><Plus className="mr-2 size-4" />{editingId ? "Save" : "Add connection"}</Button></DialogFooter></DialogContent></Dialog>;
}
