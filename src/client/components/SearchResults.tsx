/** Search results with snippets. */
import { Link } from "../router";
import type { SearchResultDto } from "../../shared/contracts/issues";
import { TypeBadge, LabelChip } from "./ui";

export function SearchResults({ results }: { results: SearchResultDto[] }) {
  if (results.length === 0) {
    return <div className="state empty">No results. Try different terms or filters.</div>;
  }
  return (
    <ul className="search-results">
      {results.map((r, i) => (
        <li key={`${r.entity_id}-${i}`} className="search-result">
          <Link to={`/issues/${r.issue_number}`} className="search-result-main">
            <span className="issue-number">#{r.issue_number}</span>
            <span className="search-title">{r.issue_title}</span>
            <TypeBadge type={r.issue_type} />
            <span className={`badge status-${r.issue_status}`}>{r.issue_status}</span>
            {r.issue_labels.map((l) => (
              <LabelChip key={l} name={l} />
            ))}
          </Link>
          {r.snippet && <p className="search-snippet">{r.snippet}</p>}
          <span className="dim">matched in {r.matched_field}</span>
        </li>
      ))}
    </ul>
  );
}
