/** Issue detail: edit, comments, history, attachments, reminders, graph panels. */
import { useCallback, useEffect, useState } from "react";
import { api, formatInstant } from "../api";
import type { CommentDto, IssueDto } from "../../shared/contracts/issues";
import { Markdown } from "../components/Markdown";
import {
  IssueEditor,
  emptyFormValues,
  formValuesFromIssue,
  recurrenceToRule,
  type IssueFormValues,
} from "../components/IssueEditor";
import { HistoryPanel } from "../components/HistoryPanel";
import { RelationshipsPanel } from "../components/RelationshipsPanel";
import { BacklinksPanel } from "../components/BacklinksPanel";
import { ReminderEditor } from "../components/ReminderEditor";
import { AttachmentSection } from "../components/AttachmentUploader";
import { SubIssuesPanel } from "../components/SubIssuesPanel";
import { TypeBadge, StatusBadge, PriorityBadge, LabelChip, Loading, ErrorState, EmptyState } from "../components/ui";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Link, useRouter } from "../router";

export function IssueDetailPage({
  mode,
  issueRef,
  wiki = false,
}: {
  mode: "view" | "create";
  issueRef?: string;
  wiki?: boolean;
}) {
  const { navigate } = useRouter();
  const [issue, setIssue] = useState<IssueDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [comments, setComments] = useState<CommentDto[] | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [crumbs, setCrumbs] = useState<{ id: string; number: number; title: string }[]>([]);

  const load = useCallback(() => {
    if (!issueRef) return;
    setError(null);
    api
      .getIssue(issueRef)
      .then((i) => {
        setIssue(i);
        void api.comments(i.number.toString()).then(setComments).catch(() => setComments([]));
        if (wiki) {
          void api.breadcrumbs(i.number.toString()).then(setCrumbs).catch(() => setCrumbs([]));
        }
      })
      .catch(setError);
  }, [issueRef, wiki]);

  useEffect(load, [load]);

  if (mode === "create") {
    return (
      <CreateIssueForm
        onCreated={(issue) => navigate(`/issues/${issue.number}`)}
        onCancel={() => navigate("/issues")}
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
      scheduled_date: values.scheduled_date ? new Date(values.scheduled_date).toISOString() : null,
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
    setComments(await api.comments(issue.number.toString()));
  };

  return (
    <article className="issue-detail flex flex-col gap-4">
      <div className="issue-head border-b border-border pb-3.5">
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
        <div className="issue-title-row flex items-baseline gap-2.5">
          <span className="issue-number big font-mono text-base text-primary">#{issue.number}</span>
          <h1 className="text-2xl font-semibold tracking-tight">{issue.title}</h1>
        </div>
        <div className="issue-tags mt-1.5 flex flex-wrap gap-1.5">
          <TypeBadge type={issue.type} />
          <StatusBadge status={issue.status} />
          {issue.priority && <PriorityBadge priority={issue.priority} />}
          {issue.labels.map((l) => (
            <LabelChip key={l} name={l} />
          ))}
        </div>
        <div className="issue-dates mt-1.5 flex flex-wrap gap-3.5">
          {issue.start_date && <span className="dim">start {issue.start_date}</span>}
          {issue.due_date && (
            <span className={issue.status === "open" && issue.due_date < today() ? "overdue-label" : "dim"}>
              due {issue.due_date}
            </span>
          )}
          {issue.scheduled_date && <span className="dim">scheduled {formatInstant(issue.scheduled_date)}</span>}
          {issue.recurrence_rule && <code className="rrule font-mono text-[11px]">{issue.recurrence_rule}</code>}
          {issue.closed_at && <span className="dim">closed {formatInstant(issue.closed_at)}</span>}
        </div>
        <div className="issue-actions mt-2.5 flex gap-2">
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
          <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>
            {editing ? "Cancel edit" : "Edit"}
          </Button>
        </div>
      </div>

      {editing ? (
        <IssueEditor
          initial={formValuesFromIssue(issue)}
          onSubmit={submitEdit}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          {issue.body ? (
            <Markdown source={issue.body} className="issue-body" />
          ) : (
            <p className="dim">No body yet. Edit to add Markdown.</p>
          )}

          <SubIssuesPanel issueRef={issue.number.toString()} rootId={issue.id} />

          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2.5 text-sm font-semibold">Attachments</h3>
            <AttachmentSection
              ownerType="issue"
              ownerId={issue.id}
              uploadUrl={`/api/attachments/issue/${issue.number}`}
            />
          </section>

          <ReminderEditor issueRef={issue.number.toString()} issue={issue} />

          <div className="detail-grid grid gap-4 md:grid-cols-2">
            <RelationshipsPanel issueRef={issue.number.toString()} issueId={issue.id} />
            <section className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-2.5 text-sm font-semibold">
                Backlinks <span className="dim">({issue.backlink_count})</span>
              </h3>
              <BacklinksPanel issueRef={issue.number.toString()} />
            </section>
          </div>

          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2.5 text-sm font-semibold">Comments</h3>
            <form className="comment-form mb-2 flex flex-col gap-2" onSubmit={addComment}>
              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Markdown comment — reference issues with #123"
                rows={4}
              />
              <Button type="submit" size="sm" className="self-start" disabled={!commentBody.trim()}>
                Comment
              </Button>
            </form>
            {comments === null ? (
              <Loading label="Loading comments…" />
            ) : comments.length === 0 ? (
              <EmptyState>No comments yet.</EmptyState>
            ) : (
              <ul className="flex flex-col">
                {comments.map((c) => (
                  <CommentItem key={c.id} comment={c} />
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2.5 text-sm font-semibold">History</h3>
            <HistoryPanel issueRef={issue.number.toString()} />
          </section>
        </>
      )}
    </article>
  );
}

function CommentItem({ comment }: { comment: CommentDto }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.updateComment(comment.id, body);
    setEditing(false);
  };

  return (
    <li className="comment border-b border-border py-2.5 last:border-b-0">
      <div className="comment-head mb-1 flex items-center gap-2.5">
        <span className="comment-author text-sm font-semibold text-primary">{comment.author}</span>
        <span className="dim">{formatInstant(comment.created_at)}</span>
        {comment.edited_at && <span className="dim">edited</span>}
        <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => setEditing((e) => !e)}>
          edit
        </Button>
      </div>
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
    </li>
  );
}

function CreateIssueForm({ onCreated, onCancel }: { onCreated: (issue: IssueDto) => void; onCancel: () => void }) {
  const [initial] = useState(emptyFormValues);
  return (
    <div>
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">New issue</h1>
      <IssueEditor
        initial={initial}
        submitLabel="Create"
        onCancel={onCancel}
        onSubmit={async (values) => {
          const issue = await api.createIssue({
            type: values.type,
            title: values.title,
            body: values.body,
            priority: values.priority || null,
            labels: values.labels,
            start_date: values.start_date || null,
            due_date: values.due_date || null,
            scheduled_date: values.scheduled_date ? new Date(values.scheduled_date).toISOString() : null,
            timezone: values.timezone,
            recurrence_rule: recurrenceToRule(values),
          });
          onCreated(issue);
        }}
      />
    </div>
  );
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
