/** Search query escaping and snippet handling. */

/**
 * Escape a user query for FTS5 MATCH: split on whitespace/punctuation, quote
 * each term, and join with AND. Empty input yields a query that matches
 * nothing rather than throwing.
 */
export function escapeFtsQuery(raw: string): string {
  const terms = raw
    .split(/[\s,.;:!?()"'-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/"/g, ""));
  if (terms.length === 0) return '""';
  return terms.map((t) => `"${t}"`).join(" ");
}

export function hasSearchableTerms(raw: string): boolean {
  return raw.split(/[\s,.;:!?()"'-]+/).some((t) => t.trim().length > 0);
}

/** Strip FTS5 highlight markers and collapse whitespace for display. */
export function cleanSnippet(snippet: string | null): string {
  if (!snippet) return "";
  return snippet.replace(/\[/g, "").replace(/\]/g, "").replace(/\s+/g, " ").trim();
}

/** Escape a label/type filter value for use inside a quoted MATCH term (unused for filters, kept for safety). */
export function escapeFtsTerm(term: string): string {
  return term.replace(/"/g, "").replace(/\s+/g, "_");
}
