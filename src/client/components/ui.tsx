/** Shared small UI pieces, built on shadcn/ui primitives. */
import type { ReactNode } from "react";
import { Link } from "../router";
import { formatInstant } from "../api";
import type { IssueDto, PlanningItemDto } from "../../shared/contracts/issues";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { cn } from "@/lib/utils";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground" role="status">
      <Skeleton className="h-4 w-48" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong";
  return (
    <Card className="my-3">
      <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-sm text-destructive">{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Card className="my-3">
      <CardContent className="py-6 text-center text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  open: "border-success text-success",
  closed: "border-border text-muted-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("capitalize", STATUS_BADGE_CLASSES[status])}>
      {status}
    </Badge>
  );
}

const PRIORITY_STYLES: Record<string, { dot: string; pill: string }> = {
  urgent: { dot: "bg-danger", pill: "border-danger/30 bg-danger/10 text-danger" },
  high: { dot: "bg-warning", pill: "border-warning/30 bg-warning/10 text-warning" },
  medium: { dot: "bg-primary", pill: "border-primary/30 bg-primary/10 text-primary" },
  low: { dot: "bg-muted-foreground", pill: "border-border text-muted-foreground" },
};

const PRIORITY_FALLBACK = { dot: "bg-muted-foreground", pill: "border-border text-muted-foreground" };

/** Colored-dot pill for detail views and sidebars. */
export function PriorityBadge({ priority }: { priority: string }) {
  const style = PRIORITY_STYLES[priority] ?? PRIORITY_FALLBACK;
  return (
    <Badge variant="outline" className={cn("capitalize", style.pill)}>
      <span className={cn("size-1.5 flex-none rounded-full", style.dot)} aria-hidden="true" />
      {priority}
    </Badge>
  );
}

/** Dot-only indicator for dense list rows. */
export function PriorityDot({ priority }: { priority: string }) {
  const style = PRIORITY_STYLES[priority] ?? PRIORITY_FALLBACK;
  return (
    <span
      className={cn("inline-block size-2 flex-none rounded-full", style.dot)}
      title={`Priority: ${priority}`}
      aria-label={`Priority: ${priority}`}
    />
  );
}

const TYPE_BADGE_CLASSES: Record<string, string> = {
  task: "text-muted-foreground",
  wiki: "border-type-wiki text-type-wiki",
  decision: "border-type-decision text-type-decision",
  finding: "border-type-finding text-type-finding",
  learning: "border-type-learning text-type-learning",
  note: "border-type-note text-type-note",
  story: "border-type-story text-type-story",
  epic: "border-type-epic text-type-epic",
  bug: "border-type-bug text-type-bug",
  incident: "border-type-incident text-type-incident",
};

export function TypeBadge({ type, className }: { type: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("capitalize", TYPE_BADGE_CLASSES[type], className)}>
      {type}
    </Badge>
  );
}

export function LabelChip({ name }: { name: string }) {
  return <span className="chip">{name}</span>;
}

export function IssueRow({
  issue,
  matched,
  matchedKind,
  showCreated = false,
  actions,
}: {
  issue: IssueDto;
  matched?: string;
  matchedKind?: string;
  showCreated?: boolean;
  actions?: ReactNode;
}) {
  return (
    <li className="issue-row flex flex-wrap items-center justify-between gap-2.5 px-2 py-2 hover:bg-accent/50">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Link
          to={`/issues/${issue.number}`}
          className="issue-row-main flex min-w-0 flex-1 items-center gap-2 text-foreground hover:no-underline"
        >
          <span className="issue-number flex-none font-mono text-xs text-muted-foreground">#{issue.number}</span>
          <span className={`dot status-dot ${issue.status}`} title={issue.status} />
          <span className="issue-title truncate">{issue.title}</span>
          {issue.priority && <PriorityDot priority={issue.priority} />}
          {issue.labels.map((l) => (
            <LabelChip key={l} name={l} />
          ))}
        </Link>
        <span className="issue-meta flex flex-none items-center gap-2">
          {matched && <span className={matchedKind === "overdue" ? "overdue-label" : "date-label"}>{matched}</span>}
          {showCreated && (
            <time
              className="issue-created text-xs text-muted-foreground"
              dateTime={issue.created_at}
              title={formatInstant(issue.created_at)}
            >
              Created {formatInstant(issue.created_at)}
            </time>
          )}
          <TypeBadge type={issue.type} className="w-20 justify-center" />
        </span>
      </div>
      {actions}
    </li>
  );
}

export function PlanningList({
  items,
  empty,
  showCreated = false,
  renderActions,
}: {
  items: PlanningItemDto[];
  empty: ReactNode;
  showCreated?: boolean;
  renderActions?: (issue: IssueDto) => ReactNode;
}) {
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <IssueRow
          key={item.issue.id}
          issue={item.issue}
          matched={item.matched}
          matchedKind={item.matched_kind}
          showCreated={showCreated}
          actions={renderActions?.(item.issue)}
        />
      ))}
    </ul>
  );
}

export function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
