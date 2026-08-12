/**
 * Right-hand issue sidebar: compact properties and relationships.
 * Attachments, backlinks, and reminders live in the main issue content tabs.
 */
import type { ReactNode } from "react";
import { formatInstant } from "../api";
import type { IssueDto } from "../../shared/contracts/issues";
import { Link } from "../router";
import { RelationshipsPanel } from "./RelationshipsPanel";
import { TypeBadge, PriorityBadge, LabelChip } from "./ui";

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border py-3.5 last:border-b-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-sm">{children}</span>
    </div>
  );
}

export function IssueSidebar({ issue }: { issue: IssueDto }) {
  const dueOverdue = issue.status === "open" && issue.due_date !== null && issue.due_date < today();
  return (
    <aside aria-label="Issue details" className="issue-sidebar min-w-0">
      <SidebarSection title="Properties">
        <PropertyRow label="Type">
          <TypeBadge type={issue.type} />
        </PropertyRow>
        <PropertyRow label="Priority">
          {issue.priority ? <PriorityBadge priority={issue.priority} /> : <span className="dim">None</span>}
        </PropertyRow>
        <PropertyRow label="Labels">
          {issue.labels.length > 0 ? (
            <span className="flex flex-wrap justify-end gap-1">
              {issue.labels.map((l) => (
                <LabelChip key={l} name={l} />
              ))}
            </span>
          ) : (
            <span className="dim">None</span>
          )}
        </PropertyRow>
        <PropertyRow label="Parent">
          {issue.parent_number !== null ? (
            <Link to={`/issues/${issue.parent_number}`} className="hover:underline">
              #{issue.parent_number}
            </Link>
          ) : (
            <span className="dim">None</span>
          )}
        </PropertyRow>
        <PropertyRow label="Start">
          {issue.start_date ? <span className="dim">start {issue.start_date}</span> : <span className="dim">None</span>}
        </PropertyRow>
        <PropertyRow label="Due">
          {issue.due_date ? (
            <span className={dueOverdue ? "overdue-label" : "dim"}>due {issue.due_date}</span>
          ) : (
            <span className="dim">None</span>
          )}
        </PropertyRow>
        <PropertyRow label="Scheduled">
          {issue.scheduled_date ? (
            <span className="dim">scheduled {formatInstant(issue.scheduled_date)}</span>
          ) : (
            <span className="dim">None</span>
          )}
        </PropertyRow>
        <PropertyRow label="Recurrence">
          {issue.recurrence_rule ? (
            <code className="rrule font-mono text-[11px]">{issue.recurrence_rule}</code>
          ) : (
            <span className="dim">None</span>
          )}
        </PropertyRow>
        <PropertyRow label="Closed">
          {issue.closed_at ? <span className="dim">closed {formatInstant(issue.closed_at)}</span> : <span className="dim">None</span>}
        </PropertyRow>
      </SidebarSection>

      <SidebarSection title="Relationships">
        <RelationshipsPanel issueRef={issue.number.toString()} issueId={issue.id} embedded />
      </SidebarSection>
    </aside>
  );
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
