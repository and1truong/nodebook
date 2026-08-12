/** Durable audit history for an issue (issue + comments). */
import { useEffect, useState } from "react";
import { api, formatInstant } from "../api";
import type { AuditEventDto } from "../../shared/contracts/issues";
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
    <ul className="history-list">
      {events.map((e) => (
        <li key={e.id} className="history-item">
          <div className="history-head">
            <span className={`badge actor-${e.actor_type}`}>{e.actor_type}</span>
            <code className="history-actor">{e.actor_id}</code>
            <span className="history-action">{e.action}</span>
            <span className="history-time">{formatInstant(e.created_at)}</span>
          </div>
          {(e.before !== null || e.after !== null) && (
            <details className="history-diff">
              <summary>payload</summary>
              <pre>{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
