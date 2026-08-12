/**
 * Inline picker for attaching an existing issue as a sub-issue.
 *
 * Candidates come from `GET /api/graph/:ref/sub-issue-candidates`, which
 * excludes the current root and every descendant server-side (recursive
 * CTE), so unexpanded branches can never leak into the picker regardless of
 * what the panel has lazily loaded. The endpoint preserves the picker's
 * semantics: recent issues when the query is empty, debounced title/body
 * LIKE search, and exact `#123` / `123` lookups merged with LIKE results.
 * Linking runs through the existing `POST /api/graph/:ref/parent` route, so
 * the server's missing-parent, self-parent, and cycle validation still apply
 * unchanged. Because NodeBook's schema allows one parent only, linking an
 * issue that already has a parent moves it — the candidate rows say so
 * explicitly.
 */
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, CornerDownRight, Loader2, Search } from "lucide-react";
import { api } from "../api";
import type { IssueDto } from "../../shared/contracts/issues";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";

const RECENT_LIMIT = 8;
const SEARCH_LIMIT = 20;

export function ExistingIssuePicker({
  issueRef,
  rootId,
  onLinked,
  onCancel,
}: {
  /** Ref of the root issue; candidates are scoped to its subtree. */
  issueRef: string;
  /** Root issue id; passed to the linking mutation. */
  rootId: string;
  /** Called after a successful link; the parent reloads its first level. */
  onLinked: () => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<IssueDto[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Monotonic sequence guarding against stale responses: only the newest
  // query may publish results.
  const seq = useRef(0);

  // Short debounce so each keystroke doesn't fire a request.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const current = ++seq.current;
    setSearchError(null);
    setResults(null);

    const apply = (issues: IssueDto[]) => {
      if (seq.current !== current) return;
      setResults(issues);
    };
    const fail = (err: unknown) => {
      if (seq.current !== current) return;
      setSearchError(err instanceof Error ? err.message : "Search failed");
    };

    // The server excludes the root and all descendants (loaded or not), and
    // treats `123` / `#123` as exact lookups merged with LIKE results.
    const limit = debounced ? SEARCH_LIMIT : RECENT_LIMIT;
    api.subIssueCandidates(issueRef, debounced, limit).then(apply).catch(fail);
  }, [debounced, issueRef]);

  const selected = results?.find((issue) => issue.id === selectedId) ?? null;
  const linking = linkingId !== null;

  const link = async (issue: IssueDto) => {
    if (linking) return;
    setLinkingId(issue.id);
    setLinkError(null);
    try {
      await api.setParent(issue.number.toString(), rootId);
      onLinked();
    } catch (err) {
      // Keep the picker and the selected result open so the server message
      // stays visible and the user can retry or pick a different issue.
      setLinkError(err instanceof Error ? err.message : "Could not link issue");
      setLinkingId(null);
    }
  };

  return (
    <form
      className="sub-issues-link-form flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (selected) void link(selected);
      }}
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          autoFocus
          className="pl-7"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedId(null);
            setLinkError(null);
          }}
          placeholder="Search by title, body, or #number"
          aria-label="Search issues"
          disabled={linking}
        />
      </div>
      {linkError && <p className="error-inline">{linkError}</p>}
      {searchError && <p className="error-inline">{searchError}</p>}
      {results === null ? (
        <div className="px-2 py-2 text-sm text-muted-foreground" role="status">
          Searching…
        </div>
      ) : results.length === 0 ? (
        <p className="px-2 py-2 text-sm text-muted-foreground">No matching issues.</p>
      ) : (
        <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {results.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                className={cn(
                  "existing-issue-result flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent/50",
                  selectedId === issue.id && "bg-accent/60",
                )}
                onClick={() => {
                  setSelectedId(issue.id);
                  setLinkError(null);
                }}
                disabled={linking}
                aria-pressed={selectedId === issue.id}
              >
                {issue.status === "closed" ? (
                  <CheckCircle2
                    className="sub-issue-icon-closed size-4 flex-none text-muted-foreground"
                    aria-label="Closed"
                  />
                ) : (
                  <Circle className="sub-issue-icon-open size-4 flex-none text-success" aria-label="Open" />
                )}
                <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                <span className="flex-none font-mono text-xs text-muted-foreground">#{issue.number}</span>
                {issue.parent_number !== null && (
                  <span className="flex-none rounded-full border border-border px-1.5 py-px text-[11px] text-muted-foreground">
                    under #{issue.parent_number}
                  </span>
                )}
                {linkingId === issue.id && (
                  <Loader2 className="size-3.5 flex-none animate-spin" aria-label="Linking" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected?.parent_number != null && (
        <p className="px-1 text-xs text-muted-foreground">
          <CornerDownRight className="mr-0.5 inline size-3 align-[-1px]" aria-hidden="true" />
          This issue already has a parent — linking moves it from its current parent.
        </p>
      )}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={!selected || linking}>
          {linking ? "Linking…" : "Link issue"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={linking} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
