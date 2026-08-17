/** Issues: paginated filtering with D1-backed saved views rendered as tabs. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { api } from "../api";
import type { IssueDto, IssueViewDto, IssueViewFilters } from "../../shared/contracts/issues";
import type { IssueStatus, IssueType } from "../../shared/limits";
import { ISSUE_TYPES } from "../../shared/limits";
import { ISSUE_PAGE_LIMITS, type IssuePageLimit } from "../../shared/contracts/config";
import { PageHeader, IssueRow, Loading, ErrorState, EmptyState } from "../components/ui";
import { Button, buttonVariants } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Link, navigate, navigateReplace, setNavigationBlocker } from "../router";

const OPEN_TAB = "open";
const OPEN_FILTERS: IssueViewFilters = { query: "", status: "open", types: [], labels: [] };

function toggleSelection<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function comparableFilters(filters: IssueViewFilters): string {
  return JSON.stringify({
    query: filters.query.trim(),
    status: filters.status,
    types: [...filters.types].sort(),
    labels: filters.labels.map((label) => label.toLowerCase()).sort(),
  });
}

export function IssuesPage({
  defaultLimit,
  selectedViewId,
}: {
  defaultLimit: IssuePageLimit | undefined;
  selectedViewId: string | null;
}) {
  const [issues, setIssues] = useState<IssueDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState<IssuePageLimit | null>(defaultLimit ?? null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>(null);
  const [types, setTypes] = useState<IssueType[]>([]);
  const [status, setStatus] = useState<IssueStatus | null>("open");
  const [labels, setLabels] = useState<string[]>([]);
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [views, setViews] = useState<IssueViewDto[] | null>(null);
  const [viewReady, setViewReady] = useState(selectedViewId === null);
  const [viewError, setViewError] = useState<unknown>(null);
  const [nameDialog, setNameDialog] = useState<"create" | "rename" | null>(null);
  const [viewName, setViewName] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [guardOpen, setGuardOpen] = useState(false);
  const guardResolve = useRef<((allow: boolean) => void) | null>(null);
  const createForNavigation = useRef(false);

  const activeView = useMemo(
    () => (selectedViewId ? views?.find((view) => view.id === selectedViewId) ?? null : null),
    [selectedViewId, views],
  );
  const currentFilters = useMemo<IssueViewFilters>(
    () => ({ query: query.trim(), status, types: [...types], labels: [...labels] }),
    [query, status, types, labels],
  );
  const savedFilters = activeView?.filters ?? OPEN_FILTERS;
  const dirty = viewReady && comparableFilters(currentFilters) !== comparableFilters(savedFilters);
  const selectedTabValue = selectedViewId && (views === null || activeView) ? selectedViewId : OPEN_TAB;

  const applyFilters = useCallback((filters: IssueViewFilters) => {
    setTypes(filters.types);
    setStatus(filters.status);
    setLabels(filters.labels);
    setAllLabels((current) => [...new Set([...current, ...filters.labels])].sort((a, b) => a.localeCompare(b)));
    setQuery(filters.query);
    setDebouncedQuery(filters.query);
    setPage(1);
  }, []);

  useEffect(() => {
    if (defaultLimit !== undefined) setLimit((current) => current ?? defaultLimit);
  }, [defaultLimit]);

  useEffect(() => {
    let cancelled = false;
    api.issueViews().then((result) => {
      if (cancelled) return;
      setViews(result);
      const selected = selectedViewId ? result.find((view) => view.id === selectedViewId) : null;
      if (selectedViewId && !selected) {
        applyFilters(OPEN_FILTERS);
        navigateReplace("/issues", true);
      } else if (selected) {
        applyFilters(selected.filters);
      }
      setViewReady(true);
    }).catch((cause) => {
      if (cancelled) return;
      setViews([]);
      setViewError(cause);
      applyFilters(OPEN_FILTERS);
      setViewReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedViewId, applyFilters]);

  useEffect(() => {
    const nextQuery = query.trim();
    const timeout = setTimeout(() => {
      if (nextQuery === debouncedQuery) return;
      setDebouncedQuery(nextQuery);
      setPage(1);
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, debouncedQuery]);

  useEffect(() => {
    if (limit === null || !viewReady) return;
    let cancelled = false;
    setIssues(null);
    setError(null);
    api.listIssues({
      type: types,
      status: status ?? undefined,
      label: labels,
      q: debouncedQuery || undefined,
      limit: String(limit),
      offset: String((page - 1) * limit),
    }).then((result) => {
      if (cancelled) return;
      const lastPage = Math.max(1, Math.ceil(result.total / limit));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setIssues(result.issues);
      setTotal(result.total);
      const discovered = result.issues.flatMap((issue) => issue.labels);
      setAllLabels((current) => [...new Set([...current, ...discovered])].sort((a, b) => a.localeCompare(b)));
    }).catch((cause) => {
      if (!cancelled) setError(cause);
    });
    return () => {
      cancelled = true;
    };
  }, [types, status, labels, debouncedQuery, limit, page, viewReady]);

  const saveActiveView = useCallback(async (): Promise<boolean> => {
    if (!activeView) return false;
    setMutating(true);
    setMutationError(null);
    try {
      const updated = await api.updateIssueView(activeView.id, { filters: currentFilters });
      setViews((current) => current?.map((view) => view.id === updated.id ? updated : view) ?? null);
      applyFilters(updated.filters);
      return true;
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to save view");
      return false;
    } finally {
      setMutating(false);
    }
  }, [activeView, currentFilters, applyFilters]);

  useEffect(() => {
    if (!dirty) return;
    return setNavigationBlocker(() => new Promise<boolean>((resolve) => {
      guardResolve.current = resolve;
      setGuardOpen(true);
    }));
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const finishGuard = (allow: boolean) => {
    setGuardOpen(false);
    const resolve = guardResolve.current;
    guardResolve.current = null;
    resolve?.(allow);
  };

  const openCreateDialog = (forNavigation = false) => {
    createForNavigation.current = forNavigation;
    setViewName("");
    setMutationError(null);
    setNameDialog("create");
  };

  const closeNameDialog = () => {
    setNameDialog(null);
    if (createForNavigation.current) {
      createForNavigation.current = false;
      finishGuard(false);
    }
  };

  const submitName = async (event: React.FormEvent) => {
    event.preventDefault();
    setMutating(true);
    setMutationError(null);
    try {
      if (nameDialog === "create") {
        const created = await api.createIssueView({ name: viewName, filters: currentFilters });
        setViews((current) => [...(current ?? []), created]);
        setNameDialog(null);
        if (createForNavigation.current) {
          createForNavigation.current = false;
          finishGuard(true);
        } else {
          navigate(`/issues?view=${encodeURIComponent(created.id)}`, true);
        }
      } else if (nameDialog === "rename" && activeView) {
        const updated = await api.updateIssueView(activeView.id, { name: viewName });
        setViews((current) => current?.map((view) => view.id === updated.id ? updated : view) ?? null);
        setNameDialog(null);
      }
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to save view");
    } finally {
      setMutating(false);
    }
  };

  const deleteActiveView = async () => {
    if (!activeView) return;
    setMutating(true);
    setMutationError(null);
    try {
      await api.deleteIssueView(activeView.id);
      setViews((current) => current?.filter((view) => view.id !== activeView.id) ?? null);
      setDeleteOpen(false);
      navigate("/issues", true);
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to delete view");
    } finally {
      setMutating(false);
    }
  };

  const resetFilters = () => applyFilters({ query: "", status: null, types: [], labels: [] });
  const hasFilters = types.length > 0 || labels.length > 0 || status !== null || query !== "";
  const pageCount = limit === null ? 1 : Math.max(1, Math.ceil(total / limit));
  const firstIssue = total === 0 || limit === null ? 0 : (page - 1) * limit + 1;
  const lastIssue = limit === null ? 0 : Math.min(page * limit, total);

  return (
    <>
      <PageHeader
        title="Issues"
        actions={<Link to="/issues/new" className={buttonVariants({ size: "sm" })}>+ New issue</Link>}
      />

      <Tabs
        value={selectedTabValue}
        onValueChange={(value) => navigate(value === OPEN_TAB ? "/issues" : `/issues?view=${encodeURIComponent(value)}`)}
        className="mt-3"
      >
        <div className="flex items-end border-b border-border">
          <TabsList className="min-w-0 flex-1 justify-start overflow-x-auto" aria-label="Issue views">
            <TabsTrigger value={OPEN_TAB}>Open{!selectedViewId && dirty ? " *" : ""}</TabsTrigger>
            {views?.map((view) => (
              <TabsTrigger key={view.id} value={view.id}>
                {view.name}{selectedViewId === view.id && dirty ? " *" : ""}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="mb-1 mr-1"
            aria-label="Save current filters as a tab"
            onClick={() => openCreateDialog()}
          >
            <Plus />
          </Button>
        </div>
      </Tabs>

      {viewError && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          Saved tabs could not be loaded. The Open view is still available.
        </div>
      )}
      {mutationError && !nameDialog && !deleteOpen && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          {mutationError}
        </div>
      )}

      <div className="mt-4 grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_220px]">
        <section className="order-2 min-w-0 md:order-1" aria-label="Issue list">
          {issues && <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">{total} {total === 1 ? "issue" : "issues"}</p>}
          {error ? <ErrorState error={error} /> : null}
          {!error && !issues && <Loading />}
          {issues && issues.length === 0 && <EmptyState>No issues match these filters.</EmptyState>}
          {issues && issues.length > 0 && <ul className="divide-y divide-border">{issues.map((issue) => <IssueRow key={issue.id} issue={issue} />)}</ul>}
          {issues && limit !== null && (
            <footer className="mt-4 flex flex-col gap-3 border-t border-border pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between" aria-label="Issue pagination">
              <span>{firstIssue}–{lastIssue} of {total}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} aria-label="Previous issue page">Previous</Button>
                <span className="min-w-20 text-center text-xs" aria-live="polite">Page {page} of {pageCount}</span>
                <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} aria-label="Next issue page">Next</Button>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="issues-page-limit" className="whitespace-nowrap text-xs">Rows per page</label>
                <Select value={String(limit)} onValueChange={(value) => { setLimit(Number(value) as IssuePageLimit); setPage(1); }}>
                  <SelectTrigger id="issues-page-limit" size="sm" className="w-20" aria-label="Rows per page"><SelectValue /></SelectTrigger>
                  <SelectContent>{ISSUE_PAGE_LIMITS.map((option) => <SelectItem key={option} value={String(option)}>{option}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </footer>
          )}
        </section>

        <aside className="order-1 md:order-2" aria-label="Issue filters">
          <div className="rounded-lg border border-border bg-card p-4 md:sticky md:top-[76px]">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Filters</h2>
              <div className="flex items-center gap-1">
                {dirty && (
                  <Button variant="outline" size="xs" disabled={mutating} onClick={() => activeView ? void saveActiveView() : openCreateDialog()}>
                    {activeView ? "Save" : "Save as tab"}
                  </Button>
                )}
                {activeView && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label="Saved tab actions"><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => { setViewName(activeView.name); setMutationError(null); setNameDialog("rename"); }}>Rename</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => { setMutationError(null); setDeleteOpen(true); }}>Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {hasFilters && <Button variant="ghost" size="xs" onClick={resetFilters}>Clear</Button>}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="issue-keyword" className="text-xs font-medium">Keyword</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input id="issue-keyword" type="search" className="h-8 pl-8 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search issues…" />
              </div>
            </div>
            <div className="my-4 h-px bg-border" />
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="issue-status">Status</label>
              <Select value={status ?? "all"} onValueChange={(value) => { setStatus(value === "all" ? null : value as IssueStatus); setPage(1); }}>
                <SelectTrigger id="issue-status" className="h-8 w-full" aria-label="Filter by status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <fieldset className="mt-5">
              <legend className="mb-2 text-xs font-medium">Issue type</legend>
              <div className="space-y-2">{ISSUE_TYPES.map((type) => (
                <label key={type} className="flex cursor-pointer items-center gap-2 text-sm capitalize">
                  <input type="checkbox" className="size-3.5 rounded border-input accent-primary" checked={types.includes(type)} onChange={() => { setTypes((current) => toggleSelection(current, type)); setPage(1); }} />
                  {type}
                </label>
              ))}</div>
            </fieldset>
            <fieldset className="mt-5">
              <legend className="mb-2 text-xs font-medium">Labels</legend>
              {allLabels.length === 0 ? <p className="text-xs text-muted-foreground">No labels found.</p> : (
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1">{allLabels.map((label) => (
                  <label key={label} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="size-3.5 rounded border-input accent-primary" checked={labels.includes(label)} onChange={() => { setLabels((current) => toggleSelection(current, label)); setPage(1); }} />
                    <span className="min-w-0 truncate" title={label}>{label}</span>
                  </label>
                ))}</div>
              )}
            </fieldset>
          </div>
        </aside>
      </div>

      <Dialog open={nameDialog !== null} onOpenChange={(open) => { if (!open && !mutating) closeNameDialog(); }}>
        <DialogContent showCloseButton={!mutating}>
          <form onSubmit={submitName} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{nameDialog === "rename" ? "Rename saved tab" : "Save filters as a tab"}</DialogTitle>
              <DialogDescription>{nameDialog === "rename" ? "Choose a new name for this tab." : "The current keyword, status, types, and labels will be saved."}</DialogDescription>
            </DialogHeader>
            <Input autoFocus aria-label="Tab name" value={viewName} onChange={(event) => setViewName(event.target.value)} maxLength={64} />
            {mutationError && <p className="text-sm text-destructive" role="alert">{mutationError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={mutating} onClick={closeNameDialog}>Cancel</Button>
              <Button type="submit" disabled={mutating || !viewName.trim()}>{mutating ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(open) => { if (!mutating) setDeleteOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{activeView?.name}”?</DialogTitle>
            <DialogDescription>This removes the saved tab. It does not delete any issues.</DialogDescription>
          </DialogHeader>
          {mutationError && <p className="text-sm text-destructive" role="alert">{mutationError}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={mutating} onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={mutating} onClick={() => void deleteActiveView()}>{mutating ? "Deleting…" : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={guardOpen} onOpenChange={(open) => { if (!open && !mutating) finishGuard(false); }}>
        <DialogContent showCloseButton={!mutating}>
          <DialogHeader>
            <DialogTitle>Save filter changes?</DialogTitle>
            <DialogDescription>This tab has filter changes that have not been saved.</DialogDescription>
          </DialogHeader>
          {mutationError && <p className="text-sm text-destructive" role="alert">{mutationError}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={mutating} onClick={() => finishGuard(false)}>Cancel</Button>
            <Button variant="outline" disabled={mutating} onClick={() => finishGuard(true)}>Discard</Button>
            <Button disabled={mutating} onClick={async () => {
              if (activeView) {
                if (await saveActiveView()) finishGuard(true);
              } else {
                setGuardOpen(false);
                openCreateDialog(true);
              }
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
