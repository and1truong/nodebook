/** Issues: filterable list with a persistent filter sidebar. */
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api } from "../api";
import type { IssueDto } from "../../shared/contracts/issues";
import { ISSUE_TYPES } from "../../shared/limits";
import { ISSUE_PAGE_LIMITS, type IssuePageLimit } from "../../shared/contracts/config";
import { PageHeader, IssueRow, Loading, ErrorState, EmptyState } from "../components/ui";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Link } from "../router";

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function IssuesPage({ defaultLimit }: { defaultLimit: IssuePageLimit | undefined }) {
  const [issues, setIssues] = useState<IssueDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState<IssuePageLimit | null>(defaultLimit ?? null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [status, setStatus] = useState("open");
  const [labels, setLabels] = useState<string[]>([]);
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    if (defaultLimit !== undefined) setLimit((current) => current ?? defaultLimit);
  }, [defaultLimit]);

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
    if (limit === null) return;

    let cancelled = false;
    setIssues(null);
    setError(null);
    api
      .listIssues({
        type: types,
        status: status || undefined,
        label: labels,
        q: debouncedQuery || undefined,
        limit: String(limit),
        offset: String((page - 1) * limit),
      })
      .then((result) => {
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
      })
      .catch((cause) => {
        if (!cancelled) setError(cause);
      });
    return () => {
      cancelled = true;
    };
  }, [types, status, labels, debouncedQuery, limit, page]);

  const hasFilters = types.length > 0 || labels.length > 0 || status !== "" || query !== "";
  const resetFilters = () => {
    setTypes([]);
    setStatus("");
    setLabels([]);
    setQuery("");
    setDebouncedQuery("");
    setPage(1);
  };

  const pageCount = limit === null ? 1 : Math.max(1, Math.ceil(total / limit));
  const firstIssue = total === 0 || limit === null ? 0 : (page - 1) * limit + 1;
  const lastIssue = limit === null ? 0 : Math.min(page * limit, total);

  return (
    <>
      <PageHeader
        title="Issues"
        actions={
          <Link to="/issues/new" className={buttonVariants({ size: "sm" })}>
            + New issue
          </Link>
        }
      />

      <div className="mt-4 grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_220px]">
        <section className="order-2 min-w-0 md:order-1" aria-label="Issue list">
          {issues && (
            <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
              {total} {total === 1 ? "issue" : "issues"}
            </p>
          )}
          {error ? <ErrorState error={error} /> : null}
          {!error && !issues && <Loading />}
          {issues && issues.length === 0 && <EmptyState>No issues match these filters.</EmptyState>}
          {issues && issues.length > 0 && (
            <ul className="divide-y divide-border">
              {issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} />
              ))}
            </ul>
          )}
          {issues && limit !== null && (
            <footer
              className="mt-4 flex flex-col gap-3 border-t border-border pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
              aria-label="Issue pagination"
            >
              <span>
                {firstIssue}–{lastIssue} of {total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  aria-label="Previous issue page"
                >
                  Previous
                </Button>
                <span className="min-w-20 text-center text-xs" aria-live="polite">
                  Page {page} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  aria-label="Next issue page"
                >
                  Next
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="issues-page-limit" className="whitespace-nowrap text-xs">
                  Rows per page
                </label>
                <Select
                  value={String(limit)}
                  onValueChange={(value) => {
                    setLimit(Number(value) as IssuePageLimit);
                    setPage(1);
                  }}
                >
                  <SelectTrigger id="issues-page-limit" size="sm" className="w-20" aria-label="Rows per page">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ISSUE_PAGE_LIMITS.map((option) => (
                      <SelectItem key={option} value={String(option)}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </footer>
          )}
        </section>

        <aside className="order-1 md:order-2" aria-label="Issue filters">
          <div className="rounded-lg border border-border bg-card p-4 md:sticky md:top-[76px]">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Filters</h2>
              {hasFilters && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={resetFilters}>
                  Clear
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="issue-keyword" className="text-xs font-medium">
                Keyword
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="issue-keyword"
                  type="search"
                  className="h-8 pl-8 text-sm"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search issues…"
                />
              </div>
            </div>

            <div className="my-4 h-px bg-border" />

            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="issue-status">
                Status
              </label>
              <Select
                value={status || "all"}
                onValueChange={(value) => {
                  setStatus(value === "all" ? "" : value);
                  setPage(1);
                }}
              >
                <SelectTrigger id="issue-status" className="h-8 w-full" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <fieldset className="mt-5">
              <legend className="mb-2 text-xs font-medium">Issue type</legend>
              <div className="space-y-2">
                {ISSUE_TYPES.map((type) => (
                  <label key={type} className="flex cursor-pointer items-center gap-2 text-sm capitalize">
                    <input
                      type="checkbox"
                      className="size-3.5 rounded border-input accent-primary"
                      checked={types.includes(type)}
                      onChange={() => {
                        setTypes((current) => toggleSelection(current, type));
                        setPage(1);
                      }}
                    />
                    {type}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-5">
              <legend className="mb-2 text-xs font-medium">Labels</legend>
              {allLabels.length === 0 ? (
                <p className="text-xs text-muted-foreground">No labels found.</p>
              ) : (
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                  {allLabels.map((label) => (
                    <label key={label} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-3.5 rounded border-input accent-primary"
                        checked={labels.includes(label)}
                        onChange={() => {
                          setLabels((current) => toggleSelection(current, label));
                          setPage(1);
                        }}
                      />
                      <span className="min-w-0 truncate" title={label}>{label}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          </div>
        </aside>
      </div>
    </>
  );
}
