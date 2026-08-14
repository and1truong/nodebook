/** Issue detail: edit, comments, history, attachments, reminders, graph panels. */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleDot, GitBranch, Pencil, X } from "lucide-react";
import { api, formatInstant } from "../api";
import type { AuditEventDto, CommentDto, IssueDto } from "../../shared/contracts/issues";
import type { WeekStartDay } from "../../shared/contracts/config";
import { Markdown } from "../components/Markdown";
import {
  IssueEditor,
  emptyFormValues,
  formValuesFromIssue,
  recurrenceToRule,
  scheduledDateToIso,
  type IssueFormValues,
} from "../components/IssueEditor";
import { HistoryItem } from "../components/HistoryPanel";
import { IssueSidebar } from "../components/IssueSidebar";
import { IssueLinkPreview } from "../components/IssueLinkPreview";
import { IssueContentTabs } from "../components/IssueContentTabs";
import { Loading, ErrorState } from "../components/ui";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Link, useRouter } from "../router";

export function IssueDetailPage({
  mode,
  issueRef,
  wiki = false,
  createType,
  weekStartDay = "sunday",
}: {
  mode: "view" | "create";
  issueRef?: string;
  wiki?: boolean;
  createType?: IssueFormValues["type"];
  /** First day of the calendar week (default Sunday). */
  weekStartDay?: WeekStartDay;
}) {
  const { navigate } = useRouter();
  const [issue, setIssue] = useState<IssueDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [comments, setComments] = useState<CommentDto[] | null>(null);
  const [history, setHistory] = useState<AuditEventDto[] | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentTab, setCommentTab] = useState<"write" | "preview">("write");
  const [crumbs, setCrumbs] = useState<{ id: string; number: number; title: string }[]>([]);

  const load = useCallback(() => {
    if (!issueRef) return;
    setError(null);
    api
      .getIssue(issueRef)
      .then((i) => {
        setIssue(i);
        void api.comments(i.number.toString()).then(setComments).catch(() => setComments([]));
        void api.history(i.number.toString()).then(setHistory).catch(() => setHistory([]));
        if (wiki) {
          void api.breadcrumbs(i.number.toString()).then(setCrumbs).catch(() => setCrumbs([]));
        }
      })
      .catch(setError);
  }, [issueRef, wiki]);

  useEffect(load, [load]);

  if (mode === "create") {
    const creatingWikiPage = createType === "wiki";
    return (
      <CreateIssueForm
        initialType={createType}
        title={creatingWikiPage ? "New wiki page" : "New issue"}
        onCreated={(issue) => navigate(creatingWikiPage ? `/wiki/${issue.number}` : `/issues/${issue.number}`)}
        onCancel={() => navigate(creatingWikiPage ? "/wiki" : "/issues")}
        weekStartDay={weekStartDay}
      />
    );
  }

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!issue) return <Loading />;

  const submitEdit = async (values: IssueFormValues) => {
    await api.updateIssue(issue.number.toString(), {
      type: values.type,
      title: values.title,
      body: values.body,
      priority: values.priority || null,
      labels: values.labels,
      start_date: values.start_date || null,
      due_date: values.due_date || null,
      scheduled_date: scheduledDateToIso(values),
      timezone: values.timezone,
      recurrence_rule: recurrenceToRule(values),
      parent_id: values.parent_id || null,
    });
    setEditing(false);
    load();
  };

  const addComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;
    await api.addComment(issue.number.toString(), commentBody);
    setCommentBody("");
    setCommentTab("write");
    const [nextComments, nextHistory] = await Promise.all([
      api.comments(issue.number.toString()),
      api.history(issue.number.toString()),
    ]);
    setComments(nextComments);
    setHistory(nextHistory);
  };

  const creatorEvent = history?.find((event) => event.action === "issue.create");
  const creator = creatorEvent?.actor_id ?? issue.created_by;
  const timeline = buildTimeline(comments ?? [], history ?? []);

  return (
    <article className="issue-detail flex flex-col gap-5">
      <div className="issue-head border-b border-border pb-4">
        {wiki && crumbs.length > 0 && (
          <nav className="mb-2 text-xs text-muted-foreground" aria-label="Breadcrumbs">
            {crumbs.map((c, i) => (
              <span key={c.id}>
                {i > 0 && " / "}
                <Link to={`/wiki/${c.number}`} className="hover:underline">
                  {c.title}
                </Link>
              </span>
            ))}
          </nav>
        )}
        <div className="issue-title-row flex items-start gap-3">
          <h1 className="min-w-0 flex-1 text-[28px] font-semibold leading-tight tracking-tight">
            {issue.title} <span className="font-normal text-muted-foreground">#{issue.number}</span>
          </h1>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing((value) => !value)}>
              <Pencil aria-hidden="true" />
              {editing ? "Cancel edit" : "Edit"}
            </Button>
            {issue.status === "open" ? (
              <>
                <Button
                  size="sm"
                  onClick={async () => {
                    await api.completeTask(issue.number.toString());
                    load();
                  }}
                >
                  ✓ Complete
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await api.closeIssue(issue.number.toString());
                    load();
                  }}
                >
                  <X aria-hidden="true" />
                  Close
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await api.reopenIssue(issue.number.toString());
                  load();
                }}
              >
                Reopen
              </Button>
            )}
          </div>
        </div>
        <div className="issue-summary mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className={`issue-state issue-state-${issue.status} inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold`}>
            {issue.status === "open" ? <CircleDot className="size-4" /> : <CheckCircle2 className="size-4" />}
            {issue.status === "open" ? "Open" : "Closed"}
          </span>
          <span>
            <strong className="font-semibold text-foreground">{creator}</strong> opened this issue {formatInstant(issue.created_at)}
          </span>
          {creatorEvent?.actor_type !== undefined && creatorEvent.actor_type !== "human" && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">{creatorEvent.actor_type}</span>
          )}
          <span aria-hidden="true">·</span>
          <span>{comments?.length ?? 0} {comments?.length === 1 ? "comment" : "comments"}</span>
          {issue.parent_number !== null && (
            <Link
              to={`/issues/${issue.parent_number}`}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-muted-foreground hover:bg-accent hover:no-underline"
            >
              <GitBranch className="size-3.5" aria-hidden="true" />
              Parent #{issue.parent_number}
            </Link>
          )}
        </div>
      </div>

      {editing ? (
        <IssueEditor
          initial={formValuesFromIssue(issue)}
          onSubmit={submitEdit}
          onCancel={() => setEditing(false)}
          variant="inline"
          weekStartDay={weekStartDay}
        />
      ) : (
        <div className="issue-layout grid grid-cols-1 gap-6 min-[1200px]:grid-cols-[minmax(0,1fr)_280px]">
          <div className="issue-main min-w-0">
            <div className="flex flex-col gap-4">
              <section className="conversation-card overflow-hidden rounded-lg border border-border bg-card">
                <header className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
                  <Avatar name={creator} inline />
                  <strong className="font-semibold text-foreground">{creator}</strong>
                  {creatorEvent?.actor_type !== undefined && creatorEvent.actor_type !== "human" && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">{creatorEvent.actor_type}</span>
                  )}
                  <span>opened this issue {formatInstant(issue.created_at)}</span>
                </header>
                <div className="min-h-24 p-4">
                  {issue.body ? (
                    <Markdown source={issue.body} className="issue-body" />
                  ) : (
                    <p className="text-sm text-muted-foreground">No description provided.</p>
                  )}
                </div>
              </section>

              <IssueContentTabs issue={issue} />
            </div>

            <ol className="issue-timeline relative mt-4 flex flex-col gap-4">
              {comments === null || history === null ? (
                <li className="timeline-entry pl-12"><Loading label="Loading conversation…" /></li>
              ) : timeline.length === 0 ? null : (
                timeline.map((item) =>
                  item.kind === "comment" ? (
                    <CommentItem
                      key={`comment-${item.value.id}`}
                      comment={item.value}
                      onSaved={() => {
                        void api.history(issue.number.toString()).then(setHistory);
                      }}
                    />
                  ) : (
                    <HistoryItem key={`history-${item.value.id}`} event={item.value} />
                  ),
                )
              )}
            </ol>

            <CommentComposer
              body={commentBody}
              tab={commentTab}
              onBodyChange={setCommentBody}
              onTabChange={setCommentTab}
              onSubmit={addComment}
            />
          </div>

          <IssueLinkPreview>
            <IssueSidebar
              issue={issue}
              onIssueUpdated={(updated) => {
                setIssue(updated);
                void api.history(updated.number.toString()).then(setHistory).catch(() => undefined);
              }}
            />
          </IssueLinkPreview>
        </div>
      )}
    </article>
  );
}

function CommentItem({ comment, onSaved }: { comment: CommentDto; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.updateComment(comment.id, body);
    setEditing(false);
    onSaved();
  };

  return (
    <li className="comment timeline-entry relative pl-12">
      <Avatar name={comment.author} />
      <section className="conversation-card overflow-hidden rounded-lg border border-border bg-card">
        <header className="comment-head flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
          <span className="comment-author text-sm font-semibold text-foreground">{comment.author}</span>
          <span className="dim">commented {formatInstant(comment.created_at)}</span>
          {comment.edited_at && <span className="dim">edited</span>}
          <Button variant="link" size="sm" className="ml-auto h-auto px-0 text-xs" onClick={() => setEditing((e) => !e)}>
            {editing ? "cancel" : "edit"}
          </Button>
        </header>
        <div className="p-4">
      {editing ? (
        <form className="flex flex-col gap-2" onSubmit={save}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setBody(comment.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Markdown source={comment.body} />
      )}
        </div>
      </section>
    </li>
  );
}

function CommentComposer({
  body,
  tab,
  onBodyChange,
  onTabChange,
  onSubmit,
}: {
  body: string;
  tab: "write" | "preview";
  onBodyChange: (value: string) => void;
  onTabChange: (tab: "write" | "preview") => void;
  onSubmit: (event: React.FormEvent) => Promise<void>;
}) {
  return (
    <div className="comment-composer relative mt-6 pl-12">
      <Avatar name="You" />
      <form className="comment-form overflow-hidden rounded-lg border border-border bg-card" onSubmit={onSubmit}>
        <div className="flex border-b border-border bg-muted/40 px-2 pt-2" role="tablist" aria-label="Comment editor mode">
          {(["write", "preview"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={`rounded-t-md border px-3 py-1.5 text-sm capitalize ${
                tab === value ? "border-border border-b-card bg-card text-foreground" : "border-transparent text-muted-foreground"
              }`}
              onClick={() => onTabChange(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="p-3">
          {tab === "write" ? (
            <Textarea
              value={body}
              onChange={(event) => onBodyChange(event.target.value)}
              placeholder="Markdown comment — reference issues with #123"
              rows={7}
              className="min-h-40 resize-y"
            />
          ) : (
            <div className="min-h-40 rounded-md border border-border p-3">
              {body.trim() ? <Markdown source={body} /> : <p className="text-sm text-muted-foreground">Nothing to preview.</p>}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5">
          <span className="text-xs text-muted-foreground">Markdown is supported</span>
          <Button type="submit" size="sm" disabled={!body.trim()}>
            Comment
          </Button>
        </div>
      </form>
    </div>
  );
}

function Avatar({ name, inline = false }: { name: string; inline?: boolean }) {
  const initials =
    name
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      className={`${inline ? "inline-avatar flex-none" : "timeline-avatar absolute left-0 top-0"} flex size-8 items-center justify-center rounded-full border border-border bg-secondary text-[11px] font-bold text-secondary-foreground`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

type TimelineItem =
  | { kind: "comment"; value: CommentDto; createdAt: string }
  | { kind: "history"; value: AuditEventDto; createdAt: string };

function buildTimeline(comments: CommentDto[], history: AuditEventDto[]): TimelineItem[] {
  const hiddenActions = new Set(["issue.create", "comment.create", "comment.update"]);
  return [
    ...comments.map((value): TimelineItem => ({ kind: "comment", value, createdAt: value.created_at })),
    ...history
      .filter((value) => !hiddenActions.has(value.action))
      .map((value): TimelineItem => ({ kind: "history", value, createdAt: value.created_at })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function CreateIssueForm({
  onCreated,
  onCancel,
  initialType,
  title,
  weekStartDay = "sunday",
}: {
  onCreated: (issue: IssueDto) => void;
  onCancel: () => void;
  initialType?: IssueFormValues["type"];
  title: string;
  weekStartDay?: WeekStartDay;
}) {
  const [initial] = useState(() => ({ ...emptyFormValues(), type: initialType ?? "task" }));
  return (
    <div>
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">{title}</h1>
      <IssueEditor
        initial={initial}
        submitLabel="Create"
        onCancel={onCancel}
        weekStartDay={weekStartDay}
        onSubmit={async (values) => {
          const issue = await api.createIssue({
            type: values.type,
            title: values.title,
            body: values.body,
            priority: values.priority || null,
            labels: values.labels,
            start_date: values.start_date || null,
            due_date: values.due_date || null,
            scheduled_date: scheduledDateToIso(values),
            timezone: values.timezone,
            recurrence_rule: recurrenceToRule(values),
          });
          onCreated(issue);
        }}
      />
    </div>
  );
}
