/**
 * Calendar view renderers: a Sunday-first month grid with compact issue
 * links, seven dated week columns, and a day agenda that separates timed
 * scheduled entries from all-day due entries. Entries link to their issues;
 * keys include issue, kind, and occurrence so dual due/scheduled entries of
 * the same issue never collide.
 */
import type { ReactNode } from "react";
import type { CalendarItemDto } from "../../shared/contracts/issues";
import type { CalendarView } from "../calendar";
import { MONTH_NAMES, WEEKDAY_LONG, WEEKDAY_SHORT, isSameMonth, monthGrid, parseDate, weekday, weekDays } from "../calendar";
import { Link } from "../router";
import { cn } from "@/lib/utils";
import { EmptyState } from "./ui";

function fullDateLabel(date: string): string {
  const p = parseDate(date);
  if (!p) return date;
  return `${WEEKDAY_LONG[weekday(date)] ?? ""}, ${MONTH_NAMES[p.month - 1] ?? ""} ${p.day}, ${p.year}`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function groupByDate(items: CalendarItemDto[]): Map<string, CalendarItemDto[]> {
  const byDate = new Map<string, CalendarItemDto[]>();
  for (const item of items) {
    const list = byDate.get(item.date) ?? [];
    list.push(item);
    byDate.set(item.date, list);
  }
  return byDate;
}

function EntryLink({
  item,
  compact = false,
}: {
  item: CalendarItemDto;
  compact?: boolean;
}) {
  const { issue, kind } = item;
  const timed = kind === "scheduled" ? formatTime(issue.scheduled_date) : null;
  const label = `${kind === "due" ? "Due" : "Scheduled"} — #${issue.number} ${issue.title}`;
  return (
    <Link
      to={`/issues/${issue.number}`}
      title={label}
      aria-label={label}
      className={cn(
        "calendar-entry flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-foreground hover:bg-accent hover:no-underline",
        compact ? "text-[11px] leading-tight" : "text-sm",
      )}
    >
      <span
        className={cn("size-1.5 flex-none rounded-full", kind === "due" ? "bg-primary" : "bg-warning")}
        aria-hidden="true"
      />
      {timed && !compact && (
        <time
          dateTime={issue.scheduled_date ?? undefined}
          className="calendar-entry-time flex-none font-mono text-xs text-muted-foreground"
        >
          {timed}
        </time>
      )}
      <span className="flex-none font-mono text-[10px] text-muted-foreground">#{issue.number}</span>
      {!compact && <span className="truncate">{issue.title}</span>}
    </Link>
  );
}

function MonthGrid({
  selected,
  today,
  items,
  onSelectDay,
}: {
  selected: string;
  today: string;
  items: CalendarItemDto[];
  onSelectDay: (date: string) => void;
}) {
  const grid = monthGrid(selected);
  const byDate = groupByDate(items);
  return (
    <div className="overflow-x-auto">
      <div className="calendar-grid grid min-w-[560px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="bg-card px-1 py-1.5 text-center text-[11px] font-medium text-muted-foreground">
            {w}
          </div>
        ))}
        {grid.map((date) => {
          const inMonth = isSameMonth(date, selected);
          const isToday = date === today;
          const dayItems = byDate.get(date) ?? [];
          return (
            <div
              key={date}
              data-date={date}
              className={cn("calendar-day-cell flex min-h-[76px] flex-col items-stretch gap-0.5 bg-card p-1", !inMonth && "opacity-45")}
            >
              <button
                type="button"
                onClick={() => onSelectDay(date)}
                aria-label={`${fullDateLabel(date)}${dayItems.length ? `, ${dayItems.length} item${dayItems.length === 1 ? "" : "s"}` : ""}`}
                className={cn(
                  "self-start rounded px-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  isToday ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {Number(date.slice(8))}
              </button>
              {dayItems.slice(0, 3).map((item) => (
                <EntryLink key={`${item.issue.id}:${item.kind}:${item.date}`} item={item} compact />
              ))}
              {dayItems.length > 3 && (
                <span className="px-1 text-[10px] leading-tight text-muted-foreground">+{dayItems.length - 3} more</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  selected,
  today,
  items,
  onSelectDay,
}: {
  selected: string;
  today: string;
  items: CalendarItemDto[];
  onSelectDay: (date: string) => void;
}) {
  const days = weekDays(selected);
  const byDate = groupByDate(items);
  return (
    <div className="overflow-x-auto">
      <div className="calendar-week grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {days.map((date) => {
          const isToday = date === today;
          const dayItems = byDate.get(date) ?? [];
          return (
            <div key={date} data-date={date} className="calendar-week-col flex min-h-[160px] flex-col bg-card">
              <button
                type="button"
                onClick={() => onSelectDay(date)}
                aria-label={fullDateLabel(date)}
                className="flex w-full flex-col items-center gap-0.5 px-1 pb-1 pt-1.5 transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {WEEKDAY_SHORT[weekday(date)]}
                </span>
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-sm font-semibold",
                    isToday ? "bg-primary text-primary-foreground" : "text-foreground",
                  )}
                >
                  {Number(date.slice(8))}
                </span>
              </button>
              <div className="flex flex-1 flex-col gap-0.5 p-1">
                {dayItems.map((item) => (
                  <EntryLink key={`${item.issue.id}:${item.kind}:${item.date}`} item={item} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayAgenda({
  selected,
  items,
}: {
  selected: string;
  items: CalendarItemDto[];
}) {
  const dayItems = groupByDate(items).get(selected) ?? [];
  const scheduled = dayItems
    .filter((i) => i.kind === "scheduled")
    .sort((a, b) => {
      const ta = new Date(a.issue.scheduled_date ?? 0).getTime();
      const tb = new Date(b.issue.scheduled_date ?? 0).getTime();
      return ta - tb;
    });
  const allDay = dayItems.filter((i) => i.kind === "due");

  const section = (title: string, entries: CalendarItemDto[], empty: ReactNode) => (
    <section aria-label={title}>
      <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
        {title}
      </h2>
      {entries.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {entries.map((item) => (
            <li key={`${item.issue.id}:${item.kind}:${item.date}`} className="px-2 py-1.5">
              <EntryLink item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div>
      {section(
        "Scheduled",
        scheduled,
        <>Nothing timed is scheduled for this day.</>,
      )}
      {section("All day", allDay, <>Nothing is due on this day.</>)}
    </div>
  );
}

export function CalendarViewRenderer({
  view,
  selected,
  today,
  items,
  onSelectDay,
}: {
  view: CalendarView;
  selected: string;
  today: string;
  items: CalendarItemDto[];
  onSelectDay: (date: string) => void;
}) {
  if (view === "month" && items.length === 0) {
    return <EmptyState>No planned work in this month.</EmptyState>;
  }
  if (view === "week" && items.length === 0) {
    return <EmptyState>No planned work this week.</EmptyState>;
  }
  if (view === "day") {
    return <DayAgenda selected={selected} items={items} />;
  }
  return view === "month" ? (
    <MonthGrid selected={selected} today={today} items={items} onSelectDay={onSelectDay} />
  ) : (
    <WeekView selected={selected} today={today} items={items} onSelectDay={onSelectDay} />
  );
}
