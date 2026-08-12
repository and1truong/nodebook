/** Incoming #-references (backlinks) panel. */
import { useEffect, useState } from "react";
import { api } from "../api";
import { Link } from "../router";
import type { BacklinkDto } from "../../shared/contracts/issues";
import { Loading, ErrorState, EmptyState } from "./ui";

export function BacklinksPanel({ issueRef }: { issueRef: string }) {
  const [items, setItems] = useState<BacklinkDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setItems(null);
    setError(null);
    api
      .backlinks(issueRef)
      .then(setItems)
      .catch(setError);
  }, [issueRef]);

  if (error) return <ErrorState error={error} />;
  if (!items) return <Loading label="Loading backlinks…" />;
  if (items.length === 0) return <EmptyState>No backlinks yet.</EmptyState>;

  return (
    <ul className="flex flex-col gap-1">
      {items.map((b) => (
        <li key={b.id} className="py-0.5">
          {b.source_number !== null ? (
            <Link to={`/issues/${b.source_number}`} className="hover:underline">
              <span className="issue-number font-mono text-xs text-muted-foreground">#{b.source_number}</span>{" "}
              {b.source_title}
            </Link>
          ) : (
            <span className="dim">referenced by a comment</span>
          )}
          <span className="dim"> → #{b.target_number}</span>
        </li>
      ))}
    </ul>
  );
}
