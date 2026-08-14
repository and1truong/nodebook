/** Searchable issue picker used by graph-linking controls. */
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Loader2, Search } from "lucide-react";
import type { IssueDto } from "../../shared/contracts/issues";
import { api } from "../api";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";

const RECENT_LIMIT = 8;
const SEARCH_LIMIT = 20;
const DIRECT_REF = /^(?:#?\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function IssueFinder({
  currentIssueId,
  value,
  selectedIssue,
  disabled = false,
  onValueChange,
  onSelect,
}: {
  currentIssueId: string;
  value: string;
  selectedIssue: IssueDto | null;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  onSelect: (issue: IssueDto | null) => void;
}) {
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<IssueDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const sequence = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = `issue-finder-${currentIssueId}`;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    const current = ++sequence.current;
    setResults(null);
    setError(null);

    const query = debounced.replace(/^#/, "");
    const search = DIRECT_REF.test(debounced)
      ? api.getIssue(query).then((issue) => [issue])
      : api
          .listIssues({ q: query || undefined, limit: String(query ? SEARCH_LIMIT : RECENT_LIMIT + 1) })
          .then((result) => result.issues);

    search
      .then((issues) => {
        if (sequence.current !== current) return;
        setResults(issues.filter((issue) => issue.id !== currentIssueId).slice(0, query ? SEARCH_LIMIT : RECENT_LIMIT));
        setActiveIndex(0);
      })
      .catch((cause: unknown) => {
        if (sequence.current !== current) return;
        // A missing direct reference is an empty finder result, not a panel-level
        // mutation failure.
        setResults([]);
        setError(cause instanceof Error ? cause.message : "Could not search issues");
      });
  }, [currentIssueId, debounced]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const choose = (issue: IssueDto) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    onSelect(issue);
    onValueChange(`#${issue.number}`);
    setOpen(false);
  };

  const visible = open && !selectedIssue;
  const activeResult = results?.[activeIndex];

  return (
    <div className="issue-finder relative w-full">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          className="w-full pl-8"
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            onSelect(null);
            setOpen(true);
          }}
          onFocus={() => {
            if (closeTimer.current) clearTimeout(closeTimer.current);
            setOpen(true);
          }}
          onBlur={() => {
            closeTimer.current = setTimeout(() => setOpen(false), 100);
          }}
          onKeyDown={(event) => {
            if (!visible || !results?.length) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % results.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => (index - 1 + results.length) % results.length);
            } else if (event.key === "Enter" && activeResult) {
              event.preventDefault();
              choose(activeResult);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
          placeholder="Find an issue…"
          aria-label="Target issue"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={listId}
          aria-activedescendant={visible && activeResult ? `${listId}-${activeResult.id}` : undefined}
          disabled={disabled}
        />
      </div>

      {selectedIssue && (
        <p className="mt-1 truncate px-1 text-xs text-muted-foreground" aria-live="polite">
          Selected: <span className="text-foreground">{selectedIssue.title}</span> #{selectedIssue.number}
        </p>
      )}

      {visible && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          {results === null ? (
            <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Searching…
            </div>
          ) : results.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">{error ? "No issue found." : "No matching issues."}</p>
          ) : (
            <ul id={listId} className="max-h-56 overflow-y-auto py-1" role="listbox" aria-label="Issue results">
              {results.map((issue, index) => (
                <li key={issue.id} role="presentation">
                  <button
                    id={`${listId}-${issue.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={cn(
                      "issue-finder-result flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-accent",
                      index === activeIndex && "bg-accent/70",
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(issue)}
                  >
                    {issue.status === "closed" ? (
                      <CheckCircle2 className="size-4 flex-none text-muted-foreground" aria-label="Closed" />
                    ) : (
                      <Circle className="size-4 flex-none text-success" aria-label="Open" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                    <span className="flex-none font-mono text-xs text-muted-foreground">#{issue.number}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
