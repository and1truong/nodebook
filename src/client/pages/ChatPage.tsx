import { useEffect, useRef, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Archive, ArrowLeft, ChevronDown, ChevronRight, Folder, FolderInput, FolderPlus, GripVertical, MessageSquarePlus, MoreHorizontal, Pencil, Plus, Search, Send, Settings2, Square, Trash2 } from "lucide-react";
import { api, streamChatMessage } from "../api";
import type { ChatActionDto, ChatConnectionDto, ChatConversationDetailDto, ChatConversationDto, ChatFolderDto, ChatMessageDto } from "../../shared/contracts/chat";
import { Markdown } from "../components/Markdown";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const RECENTS_VALUE = "recents";

export function ChatPage({ conversationId, navigate }: { conversationId?: string; navigate: (to: string) => void }) {
  const [connections, setConnections] = useState<ChatConnectionDto[]>([]);
  const [folders, setFolders] = useState<ChatFolderDto[]>([]);
  const [conversations, setConversations] = useState<ChatConversationDto[]>([]);
  const [detail, setDetail] = useState<ChatConversationDetailDto | null>(null);
  const [draft, setDraft] = useState(""); const [error, setError] = useState<string | null>(null);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [folderDialog, setFolderDialog] = useState<ChatFolderDto | "new" | null>(null);
  const [sending, setSending] = useState(false); const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const reloadLists = async () => {
    const [nextConnections, nextFolders, nextConversations] = await Promise.all([api.chatConnections(), api.chatFolders(), api.chatConversations()]);
    setConnections(nextConnections); setFolders(nextFolders); setConversations(nextConversations);
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
    const user: ChatMessageDto = { id: crypto.randomUUID(), conversation_id: conversationId, role: "user", content, status: "complete", error_message: null, sources: [], activities: [], actions: [], created_at: now, updated_at: now };
    const assistant: ChatMessageDto = { ...user, id: crypto.randomUUID(), role: "assistant", content: "", status: "streaming" };
    setDetail((current) => current ? { ...current, messages: [...current.messages, user, assistant] } : current);
    try {
      await streamChatMessage(conversationId, content, controller.signal, (event) => {
        if (event.type === "delta") setDetail((current) => current ? { ...current, messages: current.messages.map((message, index) => index === current.messages.length - 1 ? { ...message, content: message.content + event.delta } : message) } : current);
        if (event.type === "activity") setDetail((current) => current ? { ...current, messages: current.messages.map((message, index) => index === current.messages.length - 1 ? { ...message, activities: [...message.activities, event.activity] } : message) } : current);
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

  const moveConversation = async (conversation: ChatConversationDto, folderId: string | null) => {
    if (conversation.folder_id === folderId) return;
    setSidebarError(null);
    setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, folder_id: folderId } : item));
    setDetail((current) => current?.conversation.id === conversation.id
      ? { ...current, conversation: { ...current.conversation, folder_id: folderId } }
      : current);
    try {
      await api.updateChatConversation(conversation.id, { folder_id: folderId });
      await reloadLists();
    } catch (cause) {
      setSidebarError(cause instanceof Error ? cause.message : "Could not move conversation");
      await Promise.all([reloadLists(), reloadDetail()]).catch(() => undefined);
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const conversation = event.active.data.current?.conversation as ChatConversationDto | undefined;
    const target = event.over?.data.current as { folderId?: string | null } | undefined;
    if (conversation && target && "folderId" in target) void moveConversation(conversation, target.folderId ?? null);
  };

  const deleteFolder = async (folder: ChatFolderDto) => {
    if (!confirm(`Delete “${folder.name}”? Its conversations will move to Recents.`)) return;
    try {
      setSidebarError(null);
      await api.deleteChatFolder(folder.id);
      await Promise.all([reloadLists(), reloadDetail()]);
    } catch (cause) { setSidebarError(cause instanceof Error ? cause.message : "Could not delete folder"); }
  };

  const toggleFolder = (key: string) => setCollapsedFolders((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const showError = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Chat request failed");
  return (
    <div className="flex h-[calc(100vh-123px)] min-h-[480px] overflow-hidden rounded-lg border bg-card md:h-[calc(100vh-107px)]">
      <aside className={cn("w-full shrink-0 border-r md:block md:w-72", conversationId && "hidden")}>
        <div className="flex h-14 items-center gap-2 border-b px-3">
          <NewConversationDialog connections={connections} folders={folders} onCreated={(conversation) => { void reloadLists(); navigate(`/chat/${conversation.id}`); }} />
          <Button variant="outline" size="icon" title="Create folder" aria-label="Create folder" onClick={() => setFolderDialog("new")}><FolderPlus className="size-4" /></Button>
          <ConnectionDialog connections={connections} onChanged={() => void reloadLists()} />
        </div>
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="h-[calc(100%-56px)] overflow-y-auto p-2">
            {sidebarError && <p role="alert" className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{sidebarError}</p>}
            <FolderSection
              dropId="folder-recents" name="Recents" folderId={null}
              conversations={conversations.filter((item) => item.folder_id === null)}
              collapsed={collapsedFolders.has(RECENTS_VALUE)} onToggle={() => toggleFolder(RECENTS_VALUE)}
              conversationId={conversationId} folders={folders} navigate={navigate} onMove={moveConversation}
            />
            {folders.map((folder) => <FolderSection
              key={folder.id} dropId={`folder-${folder.id}`} name={folder.name} folderId={folder.id}
              conversations={conversations.filter((item) => item.folder_id === folder.id)}
              collapsed={collapsedFolders.has(folder.id)} onToggle={() => toggleFolder(folder.id)}
              conversationId={conversationId} folders={folders} navigate={navigate} onMove={moveConversation}
              onRename={() => setFolderDialog(folder)} onDelete={() => void deleteFolder(folder)}
            />)}
            {!conversations.length && !folders.length && <p className="p-4 text-center text-sm text-muted-foreground">Create a connection, then start a conversation.</p>}
          </div>
        </DndContext>
        <FolderDialog
          open={folderDialog !== null} folder={folderDialog === "new" ? null : folderDialog}
          onOpenChange={(open) => { if (!open) setFolderDialog(null); }}
          onSaved={async () => { setFolderDialog(null); await reloadLists(); }}
        />
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
                  {message.activities.map((activity) => <div key={activity.id} className="mb-3 flex items-center gap-2 rounded-md border bg-background/70 px-3 py-2 text-xs text-muted-foreground"><Search className="size-3.5" aria-hidden="true" /><span className="font-medium text-foreground">{activity.label}</span></div>)}
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

function FolderSection({
  dropId, name, folderId, conversations, collapsed, onToggle, conversationId, folders, navigate, onMove, onRename, onDelete,
}: {
  dropId: string; name: string; folderId: string | null; conversations: ChatConversationDto[]; collapsed: boolean;
  onToggle: () => void; conversationId?: string; folders: ChatFolderDto[]; navigate: (to: string) => void;
  onMove: (conversation: ChatConversationDto, folderId: string | null) => Promise<void>;
  onRename?: () => void; onDelete?: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: dropId, data: { folderId } });
  return <section ref={setNodeRef} className={cn("chat-folder mb-2 rounded-md transition-colors", isOver && "bg-accent ring-2 ring-ring/50")}>
    <div className="flex items-center gap-1 px-1">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-sm font-semibold hover:bg-accent" aria-expanded={!collapsed} onClick={onToggle}>
        {collapsed ? <ChevronRight className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">{conversations.length}</span>
      </button>
      {onRename && onDelete && <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-7" aria-label={`Manage ${name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}><Pencil />Rename</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 />Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
    {!collapsed && <div className="pb-1">
      {conversations.map((conversation) => <ConversationRow
        key={conversation.id} conversation={conversation} selected={conversation.id === conversationId}
        folders={folders} navigate={navigate} onMove={onMove}
      />)}
      {!conversations.length && <p className="px-8 py-2 text-xs text-muted-foreground">No conversations</p>}
    </div>}
  </section>;
}

function ConversationRow({ conversation, selected, folders, navigate, onMove }: {
  conversation: ChatConversationDto; selected: boolean; folders: ChatFolderDto[]; navigate: (to: string) => void;
  onMove: (conversation: ChatConversationDto, folderId: string | null) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: conversation.id, data: { conversation } });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return <div ref={setNodeRef} style={style} className={cn("chat-conversation group mb-1 flex items-center rounded-md hover:bg-accent", selected && "bg-accent", isDragging && "relative z-20 opacity-60 shadow-md")}>
    <button
      type="button" className="ml-1 flex size-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
      style={{ touchAction: "none" }} aria-label={`Drag ${conversation.title}`} {...attributes} {...listeners}
    ><GripVertical className="size-4" /></button>
    <button type="button" className="min-w-0 flex-1 px-1 py-2 text-left" onClick={() => navigate(`/chat/${conversation.id}`)}>
      <span className="block truncate text-sm font-medium">{conversation.title}</span>
      <span className="block truncate text-xs text-muted-foreground">{conversation.model}{conversation.archived ? " · archived" : ""}</span>
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="mr-1 size-7 shrink-0" aria-label={`Move ${conversation.title}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={conversation.folder_id === null} onSelect={() => void onMove(conversation, null)}><FolderInput />Recents</DropdownMenuItem>
        {folders.map((folder) => <DropdownMenuItem key={folder.id} disabled={conversation.folder_id === folder.id} onSelect={() => void onMove(conversation, folder.id)}><Folder />{folder.name}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

function FolderDialog({ open, folder, onOpenChange, onSaved }: {
  open: boolean; folder: ChatFolderDto | null; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(folder?.name ?? ""); setFormError(null); } }, [open, folder]);
  const save = async () => {
    try {
      setSaving(true); setFormError(null);
      if (folder) await api.updateChatFolder(folder.id, name);
      else await api.createChatFolder(name);
      await onSaved();
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Could not save folder"); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader>
    <DialogTitle>{folder ? "Rename folder" : "Create folder"}</DialogTitle>
    <DialogDescription>Folders only organize conversations in this phase.</DialogDescription>
  </DialogHeader>
  <Label htmlFor="chat-folder-name">Name</Label>
  <Input id="chat-folder-name" value={name} maxLength={80} autoFocus onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && name.trim() && !saving) void save(); }} />
  {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
  <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!name.trim() || saving} onClick={() => void save()}>{folder ? "Save" : "Create"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function ActionCard({ action, onUpdate }: { action: ChatActionDto; onUpdate: (action: ChatActionDto, confirm: boolean) => Promise<void> }) {
  return <div className="mt-3 rounded-lg border bg-background p-3 text-sm"><p className="font-semibold">{String(action.review.operation ?? action.action_type)}</p><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(action.review, null, 2)}</pre>{action.status === "pending" ? <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => void onUpdate(action, true)}>Confirm</Button><Button size="sm" variant="outline" onClick={() => void onUpdate(action, false)}>Dismiss</Button></div> : <p className={cn("mt-2 text-xs", action.status === "failed" && "text-destructive")}>{action.status}{action.error_message ? `: ${action.error_message}` : ""}</p>}</div>;
}

function NewConversationDialog({ connections, folders, onCreated }: { connections: ChatConnectionDto[]; folders: ChatFolderDto[]; onCreated: (conversation: ChatConversationDto) => void }) {
  const [open, setOpen] = useState(false); const [connectionId, setConnectionId] = useState(""); const [model, setModel] = useState(""); const [folderId, setFolderId] = useState(RECENTS_VALUE);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button className="flex-1"><MessageSquarePlus className="mr-2 size-4" />New chat</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>New conversation</DialogTitle><DialogDescription>The provider connection and model are pinned to this conversation.</DialogDescription></DialogHeader><Label>Connection</Label><Select value={connectionId} onValueChange={(id) => { setConnectionId(id); setModel(connections.find((item) => item.id === id)?.default_model ?? ""); }}><SelectTrigger><SelectValue placeholder="Select connection" /></SelectTrigger><SelectContent>{connections.map((connection) => <SelectItem key={connection.id} value={connection.id}>{connection.name}</SelectItem>)}</SelectContent></Select><Label>Model</Label><Input value={model} onChange={(event) => setModel(event.target.value)} /><Label>Folder</Label><Select value={folderId} onValueChange={setFolderId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={RECENTS_VALUE}>Recents</SelectItem>{folders.map((folder) => <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>)}</SelectContent></Select><DialogFooter><Button disabled={!connectionId || !model.trim()} onClick={() => void api.createChatConversation(connectionId, model, folderId === RECENTS_VALUE ? null : folderId).then((conversation) => { setOpen(false); onCreated(conversation); })}>Create</Button></DialogFooter></DialogContent></Dialog>;
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
