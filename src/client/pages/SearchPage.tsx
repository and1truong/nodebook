/** Search: full-text with type/status/label filters and knowledge mode. */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { SearchResultDto } from "../../shared/contracts/issues";
import { ISSUE_TYPES } from "../../shared/limits";
import { PageHeader, Loading, ErrorState } from "../components/ui";
import { SearchResults } from "../components/SearchResults";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [knowledge, setKnowledge] = useState(false);
  const [results, setResults] = useState<SearchResultDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const q = debounced.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setResults(null);
    setError(null);
    api
      .search({ q, type: type || undefined, status: status || undefined, knowledge })
      .then((r) => setResults(r.results))
      .catch(setError);
  }, [debounced, type, status, knowledge]);

  return (
    <>
      <PageHeader title="Search" />
      <form
        className="mb-3.5 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setDebounced(query);
        }}
      >
        <Input
          autoFocus
          className="min-w-[220px] flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, bodies, comments, labels, attachments…"
          aria-label="Search query"
        />
        <Select value={type || "all"} onValueChange={(v) => setType(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {ISSUE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">open</SelectItem>
            <SelectItem value="closed">closed</SelectItem>
          </SelectContent>
        </Select>
        <Label className="flex flex-row items-center gap-1.5 text-sm text-foreground">
          <input type="checkbox" className="accent-primary" checked={knowledge} onChange={(e) => setKnowledge(e.target.checked)} />
          knowledge first (wiki, decision, finding, incident, learning)
        </Label>
      </form>
      {error ? <ErrorState error={error} /> : null}
      {!error && debounced.trim() && !results && <Loading label="Searching…" />}
      {!debounced.trim() && <p className="dim">Search indexes issue titles/bodies, comments, labels, and attachment metadata.</p>}
      {results && <SearchResults results={results} />}
    </>
  );
}
