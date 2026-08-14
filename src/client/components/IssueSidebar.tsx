/**
 * Right-hand issue sidebar: compact properties and relationships.
 * Attachments, backlinks, and reminders live in the main issue content tabs.
 */
import { useEffect, useState, type ReactNode } from "react";
import { formatInstant, api } from "../api";
import type { IssueDto } from "../../shared/contracts/issues";
import type { WeekStartDay } from "../../shared/contracts/config";
import { ISSUE_TYPES, PRIORITIES } from "../../shared/limits";
import { todayCivil } from "../../shared/time";
import { Link } from "../router";
import { RelationshipsPanel } from "./RelationshipsPanel";
import { TypeBadge, PriorityBadge, LabelChip } from "./ui";
import { DatePicker } from "./DatePicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

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
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

export function IssueSidebar({
  issue,
  onIssueUpdated,
  weekStartDay = "sunday",
}: {
  issue: IssueDto;
  onIssueUpdated: (issue: IssueDto) => void;
  weekStartDay?: WeekStartDay;
}) {
  const today = todayCivil(new Date(), issue.timezone);
  const dueOverdue = issue.status === "open" && issue.due_date !== null && issue.due_date < today;
  return (
    <aside aria-label="Issue details" className="issue-sidebar min-w-0">
      <SidebarSection title="Properties">
        <PropertyRow label="Type">
          <TypeSelect issue={issue} onIssueUpdated={onIssueUpdated} />
        </PropertyRow>
        <PropertyRow label="Priority">
          <PrioritySelect issue={issue} onIssueUpdated={onIssueUpdated} />
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
          <DateProperty
            issue={issue}
            field="start_date"
            label="Start date"
            today={today}
            weekStartDay={weekStartDay}
            onIssueUpdated={onIssueUpdated}
          />
        </PropertyRow>
        <PropertyRow label="Due">
          <DateProperty
            issue={issue}
            field="due_date"
            label="Due date"
            today={today}
            overdue={dueOverdue}
            weekStartDay={weekStartDay}
            onIssueUpdated={onIssueUpdated}
          />
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

function TypeSelect({
  issue,
  onIssueUpdated,
}: {
  issue: IssueDto;
  onIssueUpdated: (issue: IssueDto) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateType = async (type: string) => {
    if (issue.type === type) return;
    setPending(true);
    setError(null);
    try {
      const updated = await api.updateIssue(String(issue.number), issue.version, { type });
      onIssueUpdated(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update type");
    } finally {
      setPending(false);
    }
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <Select value={issue.type} disabled={pending} onValueChange={(type) => void updateType(type)}>
        <SelectTrigger
          size="sm"
          className="h-7 max-w-full border-0 px-1.5 shadow-none hover:bg-accent"
          aria-label={`Type for #${issue.number}`}
          aria-busy={pending}
          aria-invalid={Boolean(error)}
        >
          <SelectValue>
            <TypeBadge type={issue.type} />
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {ISSUE_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              <TypeBadge type={type} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <span className="max-w-44 text-right text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

function PrioritySelect({
  issue,
  onIssueUpdated,
}: {
  issue: IssueDto;
  onIssueUpdated: (issue: IssueDto) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updatePriority = async (value: string) => {
    if ((issue.priority ?? "none") === value) return;
    setPending(true);
    setError(null);
    try {
      const updated = await api.updateIssue(String(issue.number), issue.version, {
        priority: value === "none" ? null : value,
      });
      onIssueUpdated(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update priority");
    } finally {
      setPending(false);
    }
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <Select
        value={issue.priority ?? "none"}
        disabled={pending}
        onValueChange={(value) => void updatePriority(value)}
      >
        <SelectTrigger
          size="sm"
          className="h-7 max-w-full border-0 px-1.5 shadow-none hover:bg-accent"
          aria-label={`Priority for #${issue.number}`}
          aria-busy={pending}
          aria-invalid={Boolean(error)}
        >
          <SelectValue>
            {issue.priority ? <PriorityBadge priority={issue.priority} /> : <span className="dim">None</span>}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="none">No priority</SelectItem>
          {PRIORITIES.map((priority) => (
            <SelectItem key={priority} value={priority}>
              {capitalize(priority)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <span className="max-w-44 text-right text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

function DateProperty({
  issue,
  field,
  label,
  today,
  overdue = false,
  weekStartDay,
  onIssueUpdated,
}: {
  issue: IssueDto;
  field: "start_date" | "due_date";
  label: string;
  today: string;
  overdue?: boolean;
  weekStartDay: WeekStartDay;
  onIssueUpdated: (issue: IssueDto) => void;
}) {
  const storedValue = issue[field] ?? "";
  const [value, setValue] = useState(storedValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setValue(storedValue), [storedValue]);

  const updateDate = async (nextValue: string) => {
    if (nextValue === storedValue) return;
    setValue(nextValue);
    setPending(true);
    setError(null);
    try {
      const updated = await api.updateIssue(String(issue.number), issue.version, {
        [field]: nextValue || null,
      });
      onIssueUpdated(updated);
    } catch (cause) {
      setValue(storedValue);
      setError(cause instanceof Error ? cause.message : `Could not update ${label.toLowerCase()}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1" aria-busy={pending}>
      <DatePicker
        value={value}
        today={today}
        disabled={pending}
        onChange={(nextValue) => void updateDate(nextValue)}
        ariaLabel={`${label} for #${issue.number}`}
        className="w-40"
        inputClassName={overdue ? "font-semibold text-destructive" : undefined}
        weekStartDay={weekStartDay}
      />
      {error && (
        <span className="max-w-44 text-right text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
