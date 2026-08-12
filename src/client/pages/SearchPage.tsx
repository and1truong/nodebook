/** Search: full-text with type/status/label filters and knowledge mode. */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { SearchResultDto } from "../../shared/contracts/issues";
import { ISSUE_TYPES } from "../../shared/limits";
import { PageHeader, Loading, ErrorState } from "../components/ui";
import { SearchResults } from "../components/SearchResults";

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
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          setDebounced(query);
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, bodies, comments, labels, attachments…"
          aria-label="Search query"
        />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="open">open</option>
          <option value="closed">closed</option>
        </select>
        <label className="checkline">
          <input type="checkbox" checked={knowledge} onChange={(e) => setKnowledge(e.target.checked)} />
          knowledge first (wiki, decision, finding, incident, learning)
        </label>
      </form>
      {error ? <ErrorState error={error} /> : null}
      {!error && debounced.trim() && !results && <Loading label="Searching…" />}
      {!debounced.trim() && <p className="dim">Search indexes issue titles/bodies, comments, labels, and attachment metadata.</p>}
      {results && <SearchResults results={results} />}
    </>
  );
}
