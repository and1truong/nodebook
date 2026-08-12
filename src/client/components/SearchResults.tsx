/** Search results with snippets. */
import { Link } from "../router";
import type { SearchResultDto } from "../../shared/contracts/issues";
import { TypeBadge, StatusBadge, LabelChip } from "./ui";
import { Card, CardContent } from "./ui/card";

export function SearchResults({ results }: { results: SearchResultDto[] }) {
  if (results.length === 0) {
    return (
      <Card className="my-3">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No results. Try different terms or filters.
        </CardContent>
      </Card>
    );
  }
  return (
    <ul className="flex flex-col">
      {results.map((r, i) => (
        <li key={`${r.entity_id}-${i}`} className="search-result border-b border-border py-2.5">
          <Link
            to={`/issues/${r.issue_number}`}
            className="search-result-main flex flex-wrap items-center gap-2 text-foreground hover:no-underline"
          >
            <span className="issue-number font-mono text-xs text-muted-foreground">#{r.issue_number}</span>
            <span className="search-title font-semibold">{r.issue_title}</span>
            <TypeBadge type={r.issue_type} />
            <StatusBadge status={r.issue_status} />
            {r.issue_labels.map((l) => (
              <LabelChip key={l} name={l} />
            ))}
          </Link>
          {r.snippet && <p className="search-snippet my-1.5 text-sm text-muted-foreground">{r.snippet}</p>}
          <span className="dim">matched in {r.matched_field}</span>
        </li>
      ))}
    </ul>
  );
}
