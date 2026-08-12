/**
 * GitHub-style sub-issues panel: lazy hierarchy with hierarchy guides,
 * open/closed icons, per-node completion progress (closed direct children /
 * total direct children from server-provided counts), collapsible branches,
 * and an inline create flow.
 *
 * Only one hierarchy level is fetched per request. The root's direct children
 * load when the panel mounts; every row starts collapsed and its children
 * fetch on first expansion, then stay cached while the page is open.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, ChevronDown, Circle, Link2, Plus } from "lucide-react";
import { api } from "../api";
import type { SubIssueSummaryDto } from "../../shared/contracts/issues";
import { Link } from "../router";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ExistingIssuePicker } from "./ExistingIssuePicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "@/lib/utils";

type ActionMode = "idle" | "create" | "link";

/** Shared lazy-branch state threaded through the recursive node renderer. */
interface BranchHandlers {
  expanded: ReadonlySet<string>;
  loading: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
  cache: ReadonlyMap<string, SubIssueSummaryDto[]>;
  onToggle: (id: string, number: number) => void;
  onRetry: (id: string, number: number) => void;
}

export function SubIssuesPanel({ issueRef, rootId }: { issueRef: string; rootId: string }) {
  const [tree, setTree] = useState<SubIssueSummaryDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<ActionMode>("idle");
  const [title, setTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Lazy branches: which rows are expanded, which branch is fetching right
  // now, per-branch failures (isolated and retryable), and successfully
  // loaded children keyed by issue id. A ref mirrors the cache so toggle
  // guards don't depend on a stale render closure.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [loadingBranches, setLoadingBranches] = useState<ReadonlySet<string>>(new Set());
  const [branchErrors, setBranchErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [childrenCache, setChildrenCache] = useState<ReadonlyMap<string, SubIssueSummaryDto[]>>(new Map());
  const cacheRef = useRef<ReadonlyMap<string, SubIssueSummaryDto[]>>(childrenCache);

  const loadBranch = useCallback((id: string, number: number) => {
    setBranchErrors((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setLoadingBranches((prev) => new Set(prev).add(id));
    api
      .subIssues(String(number))
      .then((children) => {
        const next = new Map(cacheRef.current);
        next.set(id, children);
        cacheRef.current = next;
        setChildrenCache(next);
      })
      .catch((err) => {
        // The branch stays expanded with an inline error and Retry button;
        // failures never poison the rest of the tree.
        setBranchErrors((prev) => {
          const next = new Map(prev);
          next.set(id, err instanceof Error ? err.message : "Could not load children");
          return next;
        });
      })
      .finally(() => {
        setLoadingBranches((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
  }, []);

  const toggleBranch = useCallback(
    (id: string, number: number) => {
      const expanding = !expanded.has(id);
      // Pure state update; the fetch decision below runs once per click (not
      // inside the updater, which StrictMode double-invokes in dev) and uses
      // the pre-toggle expansion state so collapsing never refetches.
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      // First expansion fetches this branch; later toggles reuse the cache.
      if (expanding && !cacheRef.current.has(id) && !loadingBranches.has(id) && !branchErrors.has(id)) {
        loadBranch(id, number);
      }
    },
    [expanded, loadBranch, loadingBranches, branchErrors],
  );

  // Monotonic sequence guarding against stale responses: every load (effect,
  // create-submit, linked, retry) stamps a newer sequence, and only the newest
  // may publish. Navigation bumps the sequence via the effect, so an older
  // request resolving late can never clobber the current issue's tree.
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    setError(null);
    api
      .subIssues(issueRef)
      .then((tree) => {
        if (loadSeq.current === seq) setTree(tree);
      })
      .catch((err) => {
        if (loadSeq.current === seq) setError(err);
      });
  }, [issueRef]);

  useEffect(() => {
    // Navigating to another issue resets all cached branches and expansion
    // state so the panel starts fresh (root level only, all rows collapsed).
    // The load's sequence stamp invalidates any in-flight request from the
    // previous issue.
    cacheRef.current = new Map();
    setChildrenCache(new Map());
    setExpanded(new Set());
    setBranchErrors(new Map());
    setLoadingBranches(new Set());
    load();
  }, [load]);

  const roots = tree ?? [];
  const hasError = !!error;
  const total = roots.length;
  const closed = roots.filter((n) => n.status === "closed").length;
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
      setMode("idle");
      // Refresh the first level only; deeper cached branches are untouched
      // (a full reload restores authoritative state).
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create sub-issue");
    } finally {
      setSubmitting(false);
    }
  };

  const handlers: BranchHandlers = {
    expanded,
    loading: loadingBranches,
    errors: branchErrors,
    cache: childrenCache,
    onToggle: toggleBranch,
    onRetry: loadBranch,
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
              No sub-issues yet. Create one below or add an existing issue.
            </p>
          )}
          {tree !== null && !hasError && roots.length > 0 && (
            <ul className="sub-issues-tree flex flex-col" aria-label="Sub-issues">
              {roots.map((node) => (
                <SubIssueNode key={node.id} node={node} depth={0} handlers={handlers} />
              ))}
            </ul>
          )}
          <div className="sub-issues-create border-t border-border p-2">
            {mode === "create" ? (
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
                      setMode("idle");
                      setTitle("");
                      setCreateError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : mode === "link" ? (
              <ExistingIssuePicker
                issueRef={issueRef}
                rootId={rootId}
                onLinked={() => {
                  setMode("idle");
                  load();
                }}
                onCancel={() => setMode("idle")}
              />
            ) : (
              <div className="sub-issues-action flex">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 rounded-r-none"
                  onClick={() => setMode("create")}
                >
                  Create sub-issue
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-l-none border-l-0 px-2.5"
                      aria-label="Sub-issue actions"
                    >
                      <ChevronDown className="size-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="sub-issues-action-menu min-w-[13rem]">
                    <DropdownMenuItem onSelect={() => setMode("create")}>
                      <Plus aria-hidden="true" />
                      Create sub-issue
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setMode("link")}>
                      <Link2 aria-hidden="true" />
                      Add existing issue
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SubIssueNode({
  node,
  depth,
  handlers,
}: {
  node: SubIssueSummaryDto;
  depth: number;
  handlers: BranchHandlers;
}) {
  const expanded = handlers.expanded.has(node.id);
  const hasChildren = node.child_count > 0;
  const loading = handlers.loading.has(node.id);
  const branchError = handlers.errors.get(node.id);
  const children = handlers.cache.get(node.id);
  const closed = node.status === "closed";
  const total = node.child_count;
  const closedCount = node.closed_child_count;
  const done = total > 0 && closedCount === total;

  return (
    <li className="sub-issue-row">
      <div
        className="issue-row flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
        style={{ paddingLeft: depth * 20 + 6 }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="sub-issue-toggle flex size-4 flex-none cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted-foreground"
            onClick={() => handlers.onToggle(node.id, node.number)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} children of #${node.number} ${node.title}`}
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
          to={`/issues/${node.number}`}
          className="sub-issue-link flex min-w-0 flex-1 items-baseline gap-1.5 text-foreground hover:no-underline"
        >
          <span className="issue-title truncate">{node.title}</span>
          <span className="issue-number flex-none font-mono text-xs text-muted-foreground">#{node.number}</span>
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
      {expanded && (loading || branchError) && (
        <div className="ml-[22px] border-l border-border pl-1">
          {loading && (
            <div className="sub-issue-branch-loading px-2 py-2 text-sm text-muted-foreground" role="status">
              Loading children…
            </div>
          )}
          {branchError && (
            <div className="sub-issue-branch-error flex items-center justify-between gap-2 px-2 py-2">
              <p className="text-sm text-destructive">Could not load children.</p>
              <Button variant="outline" size="sm" onClick={() => handlers.onRetry(node.id, node.number)}>
                Retry
              </Button>
            </div>
          )}
        </div>
      )}
      {expanded && !loading && !branchError && children && (
        <ul className="sub-issues-children ml-[22px] flex flex-col border-l border-border pl-1">
          {children.map((child) => (
            <SubIssueNode key={child.id} node={child} depth={depth + 1} handlers={handlers} />
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
