/** Compact audit event rendered inside the issue conversation timeline. */
import { Activity } from "lucide-react";
import { formatInstant } from "../api";
import type { AuditEventDto } from "../../shared/contracts/issues";
import { Badge } from "./ui/badge";
import { creatorLabel } from "../attribution";

const ACTION_LABELS: Record<string, string> = {
  "issue.update": "updated the issue",
  "issue.close": "closed the issue",
  "issue.reopen": "reopened the issue",
  "issue.complete": "completed the issue",
};

export function HistoryItem({ event }: { event: AuditEventDto }) {
  return (
    <li className="history-item timeline-entry relative py-3 pl-12">
      <span className="timeline-icon absolute left-2 top-3.5 flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
        <Activity className="size-3.5" aria-hidden="true" />
      </span>
      <div className="history-head flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="history-actor font-semibold text-foreground" title={`Actor: ${event.actor_type}:${event.actor_id}`}>
          {creatorLabel(event.creator)}
        </span>
        <span className="history-action">{ACTION_LABELS[event.action] ?? event.action}</span>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {event.creator.via}
        </Badge>
        <span className="history-time">{formatInstant(event.created_at)}</span>
      </div>
      {(event.before !== null || event.after !== null) && (
        <details className="history-diff mt-1.5">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">View changes</summary>
          <pre className="mt-1 max-h-[300px] overflow-x-auto rounded-md border border-border bg-muted p-2.5 text-[11px]">
            {JSON.stringify({ before: event.before, after: event.after }, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}
