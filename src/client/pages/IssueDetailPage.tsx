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
import { TypeBadge, StatusBadge, LabelChip, Loading, ErrorState, EmptyState } from "../components/ui";
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
  const [children, setChildren] = useState<IssueDto[] | null>(null);

  const load = useCallback(() => {
    if (!issueRef) return;
    setError(null);
    api
      .getIssue(issueRef)
      .then((i) => {
        setIssue(i);
        void api.comments(i.number.toString()).then(setComments).catch(() => setComments([]));
        void api.children(i.number.toString()).then(setChildren).catch(() => setChildren([]));
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
    <article className="issue-detail">
      <div className="issue-head">
        {wiki && crumbs.length > 0 && (
          <nav className="breadcrumbs" aria-label="Breadcrumbs">
            {crumbs.map((c, i) => (
              <span key={c.id}>
                {i > 0 && " / "}
                <Link to={`/wiki/${c.number}`}>{c.title}</Link>
              </span>
            ))}
          </nav>
        )}
        <div className="issue-title-row">
          <span className="issue-number big">#{issue.number}</span>
          <h1>{issue.title}</h1>
        </div>
        <div className="issue-tags">
          <TypeBadge type={issue.type} />
          <StatusBadge status={issue.status} />
          {issue.priority && <span className={`badge prio-${issue.priority}`}>{issue.priority}</span>}
          {issue.labels.map((l) => (
            <LabelChip key={l} name={l} />
          ))}
        </div>
        <div className="issue-dates dim">
          {issue.start_date && <span>start {issue.start_date}</span>}
          {issue.due_date && <span className={issue.status === "open" && issue.due_date < today() ? "overdue-label" : ""}>due {issue.due_date}</span>}
          {issue.scheduled_date && <span>scheduled {formatInstant(issue.scheduled_date)}</span>}
          {issue.recurrence_rule && <code className="rrule">{issue.recurrence_rule}</code>}
          {issue.closed_at && <span>closed {formatInstant(issue.closed_at)}</span>}
        </div>
        <div className="issue-actions">
          {issue.status === "open" ? (
            <>
              <button className="btn small" onClick={async () => { await api.completeTask(issue.number.toString()); load(); }}>
                ✓ Complete
              </button>
              <button className="btn small" onClick={async () => { await api.closeIssue(issue.number.toString()); load(); }}>
                Close
              </button>
            </>
          ) : (
            <button className="btn small" onClick={async () => { await api.reopenIssue(issue.number.toString()); load(); }}>
              Reopen
            </button>
          )}
          <button className="btn small" onClick={() => setEditing((e) => !e)}>
            {editing ? "Cancel edit" : "Edit"}
          </button>
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

          <section className="panel">
            <h3>Attachments</h3>
            <AttachmentSection
              ownerType="issue"
              ownerId={issue.id}
              uploadUrl={`/api/attachments/issue/${issue.number}`}
            />
          </section>

          <ReminderEditor issueRef={issue.number.toString()} issue={issue} />

          <div className="detail-grid">
            <RelationshipsPanel issueRef={issue.number.toString()} issueId={issue.id} />
            <section className="panel">
              <h3>
                Backlinks <span className="dim">({issue.backlink_count})</span>
              </h3>
              <BacklinksPanel issueRef={issue.number.toString()} />
            </section>
          </div>

          <section className="panel">
            <h3>
              Children <span className="dim">({issue.child_count})</span>
            </h3>
            {children === null ? (
              <Loading label="Loading children…" />
            ) : children.length === 0 ? (
              <EmptyState>No children. Add one below.</EmptyState>
            ) : (
              <ul className="issue-list compact">
                {children.map((c) => (
                  <li key={c.id} className="issue-row">
                    <Link to={`/issues/${c.number}`} className="issue-row-main">
                      <span className="issue-number">#{c.number}</span>
                      <span className="issue-title">{c.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const title = (form.elements.namedItem("child-title") as HTMLInputElement).value.trim();
                if (!title) return;
                await api.createIssue({ title, type: "task", parent_id: issue.id });
                (form.elements.namedItem("child-title") as HTMLInputElement).value = "";
                load();
              }}
            >
              <input name="child-title" placeholder="Child issue title" aria-label="Child issue title" />
              <button type="submit" className="btn small">
                Add child
              </button>
            </form>
          </section>

          <section className="panel">
            <h3>Comments</h3>
            <form className="comment-form" onSubmit={addComment}>
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Markdown comment — reference issues with #123"
                rows={4}
              />
              <button type="submit" className="btn small primary" disabled={!commentBody.trim()}>
                Comment
              </button>
            </form>
            {comments === null ? (
              <Loading label="Loading comments…" />
            ) : comments.length === 0 ? (
              <EmptyState>No comments yet.</EmptyState>
            ) : (
              <ul className="comment-list">
                {comments.map((c) => (
                  <CommentItem key={c.id} comment={c} />
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h3>History</h3>
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
    <li className="comment">
      <div className="comment-head">
        <span className="comment-author">{comment.author}</span>
        <span className="dim">{formatInstant(comment.created_at)}</span>
        {comment.edited_at && <span className="dim">edited</span>}
        <button className="linklike" onClick={() => setEditing((e) => !e)}>
          edit
        </button>
      </div>
      {editing ? (
        <form onSubmit={save}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          <button type="submit" className="btn small primary">
            Save
          </button>
          <button type="button" className="btn small" onClick={() => { setBody(comment.body); setEditing(false); }}>
            Cancel
          </button>
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
      <h1>New issue</h1>
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
