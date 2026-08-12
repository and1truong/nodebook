/**
 * GitHub-style sub-issues panel: recursive tree with hierarchy guides,
 * open/closed icons, per-node completion progress (closed direct children /
 * total direct children), collapsible branches, and an inline create flow.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { api } from "../api";
import type { SubIssueNodeDto } from "../../shared/contracts/issues";
import { Link } from "../router";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";

export function SubIssuesPanel({ issueRef, rootId }: { issueRef: string; rootId: string }) {
  const [tree, setTree] = useState<SubIssueNodeDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    // Guard against stale responses: if issueRef changes (client-side
    // navigation) or the panel unmounts before the request settles, the
    // cleanup cancels this load so an older tree can't clobber the current
    // issue's panel.
    let cancelled = false;
    setError(null);
    api
      .subIssues(issueRef)
      .then((tree) => {
        if (!cancelled) setTree(tree);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [issueRef]);

  useEffect(() => load(), [load]);

  const roots = tree ?? [];
  const hasError = !!error;
  const total = roots.length;
  const closed = roots.filter((n) => n.issue.status === "closed").length;
  const complete = total > 0 && closed === total;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      await api.createIssue({ title: trimmed, type: "task", parent_id: rootId });
      setTitle("");
      setCreating(false);
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create sub-issue");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="sub-issues rounded-lg border border-border bg-card">
      <button
        type="button"
        className="sub-issues-header flex w-full cursor-pointer items-center gap-2 rounded-t-lg border-b border-border px-4 py-2.5 text-left hover:bg-accent/40"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Collapse sub-issues" : "Expand sub-issues"}
      >
        <span className="text-sm font-semibold">Sub-issues</span>
        {total > 0 && (
          <span
            className={cn(
              "sub-issues-progress inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
              complete ? "border-success/40 text-success" : "border-border text-muted-foreground",
            )}
          >
            {complete && <CheckCircle2 className="size-3" aria-hidden="true" />}
            {closed}/{total}
          </span>
        )}
        <span className="ml-auto text-muted-foreground" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="sub-issues-body p-1.5">
          {tree === null && !hasError && <Loading label="Loading sub-issues…" />}
          {hasError && (
            <div className="flex items-center justify-between gap-2 px-2 py-3">
              <p className="text-sm text-destructive">Could not load sub-issues.</p>
              <Button variant="outline" size="sm" onClick={load}>
                Retry
              </Button>
            </div>
          )}
          {tree !== null && !hasError && roots.length === 0 && (
            <p className="sub-issues-empty px-2 py-3 text-sm text-muted-foreground">
              No sub-issues yet. Create one below.
            </p>
          )}
          {tree !== null && !hasError && roots.length > 0 && (
            <ul className="sub-issues-tree flex flex-col" role="tree" aria-label="Sub-issues">
              {roots.map((node) => (
                <SubIssueNode key={node.issue.id} node={node} depth={0} />
              ))}
            </ul>
          )}
          <div className="sub-issues-create border-t border-border p-2">
            {creating ? (
              <form className="sub-issues-create-form flex flex-col gap-1.5" onSubmit={submit}>
                <Input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Sub-issue title"
                  aria-label="Sub-issue title"
                  maxLength={500}
                  disabled={submitting}
                />
                {createError && <p className="error-inline">{createError}</p>}
                <div className="flex gap-1.5">
                  <Button type="submit" size="sm" disabled={!title.trim() || submitting}>
                    Create
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => {
                      setCreating(false);
                      setTitle("");
                      setCreateError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setCreating(true)}>
                + Create sub-issue
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SubIssueNode({ node, depth }: { node: SubIssueNodeDto; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const issue = node.issue;
  const hasChildren = node.children.length > 0;
  const closed = issue.status === "closed";
  const total = node.children.length;
  const closedCount = node.children.filter((c) => c.issue.status === "closed").length;
  const done = total > 0 && closedCount === total;

  return (
    <li className="sub-issue-row" role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div
        className="issue-row flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
        style={{ paddingLeft: depth * 20 + 6 }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="sub-issue-toggle flex size-4 flex-none cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted-foreground"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} children of #${issue.number} ${issue.title}`}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="sub-issue-toggle flex size-4 flex-none items-center justify-center text-muted-foreground/50">
            ·
          </span>
        )}
        {closed ? (
          <CheckCircle2
            className="sub-issue-icon sub-issue-icon-closed size-4 flex-none text-muted-foreground"
            aria-label="Closed"
          />
        ) : (
          <Circle className="sub-issue-icon sub-issue-icon-open size-4 flex-none text-success" aria-label="Open" />
        )}
        <Link
          to={`/issues/${issue.number}`}
          className="sub-issue-link flex min-w-0 flex-1 items-baseline gap-1.5 text-foreground hover:no-underline"
        >
          <span className="issue-title truncate">{issue.title}</span>
          <span className="issue-number flex-none font-mono text-xs text-muted-foreground">#{issue.number}</span>
        </Link>
        {total > 0 && (
          <span
            className={cn(
              "sub-issues-progress flex-none rounded-full border px-1.5 py-px text-[11px] font-medium",
              done ? "border-success/40 text-success" : "border-border text-muted-foreground",
            )}
          >
            {done && <CheckCircle2 className="mr-0.5 inline size-3 align-[-1px]" aria-hidden="true" />}
            {closedCount}/{total}
          </span>
        )}
      </div>
      {hasChildren && expanded && (
        <ul className="sub-issues-children ml-[22px] flex flex-col border-l border-border pl-1" role="group">
          {node.children.map((child) => (
            <SubIssueNode key={child.issue.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="px-2 py-3 text-sm text-muted-foreground" role="status">
      {label}
    </div>
  );
}
