/** Durable audit history for an issue (issue + comments). */
import { useEffect, useState } from "react";
import { api, formatInstant } from "../api";
import type { AuditEventDto } from "../../shared/contracts/issues";
import { Badge } from "./ui/badge";
import { Loading, ErrorState, EmptyState } from "./ui";

export function HistoryPanel({ issueRef }: { issueRef: string }) {
  const [events, setEvents] = useState<AuditEventDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setEvents(null);
    setError(null);
    api
      .history(issueRef)
      .then(setEvents)
      .catch(setError);
  }, [issueRef]);

  if (error) return <ErrorState error={error} />;
  if (!events) return <Loading label="Loading history…" />;
  if (events.length === 0) return <EmptyState>No history yet.</EmptyState>;

  return (
    <ul className="flex flex-col">
      {events.map((e) => (
        <li key={e.id} className="history-item border-b border-border py-1.5 last:border-b-0">
          <div className="history-head flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-muted-foreground">
              {e.actor_type}
            </Badge>
            <code className="history-actor text-[11px]">{e.actor_id}</code>
            <span className="history-action text-xs font-semibold">{e.action}</span>
            <span className="history-time ml-auto text-[11px] text-muted-foreground">{formatInstant(e.created_at)}</span>
          </div>
          {(e.before !== null || e.after !== null) && (
            <details className="history-diff">
              <summary className="cursor-pointer text-[11px] text-muted-foreground">payload</summary>
              <pre className="max-h-[300px] overflow-x-auto rounded-md bg-muted p-2.5 text-[11px]">
                {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
              </pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
