/** Incoming #-references (backlinks) panel. */
import { useEffect, useState } from "react";
import { api } from "../api";
import { Link } from "../router";
import type { BacklinkDto } from "../../shared/contracts/issues";
import { Loading, ErrorState, EmptyState } from "./ui";

export type BacklinksLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; count: number };

export function BacklinksPanel({
  issueRef,
  onLoadStateChange,
}: {
  issueRef: string;
  onLoadStateChange?: (state: BacklinksLoadState) => void;
}) {
  const [items, setItems] = useState<BacklinkDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    onLoadStateChange?.({ status: "loading" });
    api
      .backlinks(issueRef)
      .then((nextItems) => {
        if (cancelled) return;
        setItems(nextItems);
        onLoadStateChange?.({ status: "ready", count: nextItems.length });
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError);
        onLoadStateChange?.({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [issueRef, onLoadStateChange]);

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
