/** Shared small UI pieces. */
import type { ReactNode } from "react";
import { Link } from "../router";
import type { IssueDto, PlanningItemDto } from "../../shared/contracts/issues";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="state loading">{label}</div>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div className="state error">
      <p>{message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="state empty">{children}</div>;
}

export function TypeBadge({ type }: { type: string }) {
  return <span className={`badge type-${type}`}>{type}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge status-${status}`}>{status}</span>;
}

export function LabelChip({ name }: { name: string }) {
  return <span className="chip">{name}</span>;
}

export function IssueRow({ issue, matched, matchedKind }: { issue: IssueDto; matched?: string; matchedKind?: string }) {
  return (
    <li className="issue-row">
      <Link to={`/issues/${issue.number}`} className="issue-row-main">
        <span className="issue-number">#{issue.number}</span>
        <span className={`dot status-dot ${issue.status}`} title={issue.status} />
        <span className="issue-title">{issue.title}</span>
        {issue.priority && <span className={`badge prio-${issue.priority}`}>{issue.priority}</span>}
        {issue.labels.map((l) => (
          <LabelChip key={l} name={l} />
        ))}
      </Link>
      <span className="issue-meta">
        {matched && <span className={matchedKind === "overdue" ? "overdue-label" : "date-label"}>{matched}</span>}
        <TypeBadge type={issue.type} />
      </span>
    </li>
  );
}

export function PlanningList({ items, empty }: { items: PlanningItemDto[]; empty: ReactNode }) {
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="issue-list">
      {items.map((item) => (
        <IssueRow key={item.issue.id} issue={item.issue} matched={item.matched} matchedKind={item.matched_kind} />
      ))}
    </ul>
  );
}

export function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
