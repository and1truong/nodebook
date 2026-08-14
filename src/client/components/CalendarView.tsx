/**
 * Calendar view renderers: a Sunday-first month grid with compact issue
 * links, seven dated week columns, and a day agenda that separates timed
 * scheduled entries from all-day due entries. Entries link to their issues;
 * keys include issue, kind, and occurrence so dual due/scheduled entries of
 * the same issue never collide.
 *
 * Dragging: entries (pointer with a movement threshold, delayed touch, and
 * keyboard) are draggable onto month cells and week columns; the day agenda
 * is the non-drag fallback with a "Move date…" picker per entry. Drags only
 * start after the activation threshold, so ordinary link clicks still
 * navigate. A drag overlay, active/target styling, auto-scroll, and screen
 * reader announcements accompany the interaction.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { CollisionDetection, DragEndEvent, DragStartEvent, KeyboardCoordinateGetter } from "@dnd-kit/core";
import type { CalendarItemDto } from "../../shared/contracts/issues";
import type { CalendarView } from "../calendar";
import { MONTH_NAMES, WEEKDAY_LONG, WEEKDAY_SHORT, addDays, isSameMonth, monthGrid, parseDate, weekday, weekDays } from "../calendar";
import { Link } from "../router";
import { cn } from "@/lib/utils";
import { EmptyState } from "./ui";
import { DatePicker } from "./DatePicker";
import { Button } from "./ui/button";

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

function EntryLink({ item, compact = false }: { item: CalendarItemDto; compact?: boolean }) {
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

// ---------------------------------------------------------------------------
// Drag and drop primitives
// ---------------------------------------------------------------------------

/** One day on the grid/columns; the drop target for dragged entries. */
function DroppableDate({
  date,
  className,
  children,
}: {
  date: string;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `date:${date}`, data: { date } });
  return (
    <div
      ref={setNodeRef}
      data-date={date}
      className={cn(className, isOver && "calendar-drop-target bg-accent/50 ring-2 ring-inset ring-primary/60")}
    >
      {children}
    </div>
  );
}

/** Draggable entry: drags only after the activation threshold, so the inner
 *  issue link keeps normal click navigation. Keyboard users focus the entry
 *  (role="button"), press Space/Enter to pick up, arrows to move, Space to
 *  drop. Moves of an issue with an in-flight PATCH are disabled. */
function DraggableEntry({
  item,
  compact,
  busy,
}: {
  item: CalendarItemDto;
  compact: boolean;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${item.issue.id}:${item.kind}:${item.date}`,
    data: { item },
    disabled: busy,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-busy={busy || undefined}
      title={busy ? "Move in progress" : "Drag to reschedule"}
      className={cn(
        "calendar-drag-handle cursor-grab rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isDragging && "opacity-40",
        busy && "cursor-wait opacity-60",
      )}
    >
      <EntryLink item={item} compact={compact} />
    </div>
  );
}

/** Move keyboard drags by calendar date rather than fragile pixel steps.
 * Left/right select adjacent dates; up/down select the same weekday in the
 * previous/next week when that date is present in the rendered range. */
const calendarCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

const keyboardCoordinatesGetter: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  const overDate = context.over?.data.current?.date;
  const activeItem = context.active?.data.current?.item as CalendarItemDto | undefined;
  const date = typeof overDate === "string" ? overDate : activeItem?.date;
  if (!date) return undefined;

  const dayDelta =
    event.code === "ArrowRight" ? 1
    : event.code === "ArrowLeft" ? -1
    : event.code === "ArrowDown" ? 7
    : event.code === "ArrowUp" ? -7
    : 0;
  if (!dayDelta) return undefined;

  const targetDate = addDays(date, dayDelta);
  const target = context.droppableContainers
    .getEnabled()
    .find((container) => container.data.current?.date === targetDate);
  const targetRect = target ? context.droppableRects.get(target.id) ?? target.rect.current : undefined;
  const collisionRect = context.collisionRect;
  if (!targetRect || !collisionRect) return currentCoordinates;

  const horizontal = event.code === "ArrowRight" || event.code === "ArrowLeft";
  return {
    x: horizontal ? targetRect.left + (targetRect.width - collisionRect.width) / 2 : currentCoordinates.x,
    y: horizontal ? currentCoordinates.y : targetRect.top + (targetRect.height - collisionRect.height) / 2,
  };
};

/** "Move date…" fallback: opens the existing date picker for the entry. */
function MoveDateControl({
  item,
  today,
  onMove,
}: {
  item: CalendarItemDto;
  today: string;
  onMove: (item: CalendarItemDto, date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex-none">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        className="h-6 px-1.5 text-xs text-muted-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        Move date…
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 rounded-lg border border-border bg-popover p-2 shadow-md">
          <DatePicker
            id={`move-${item.issue.id}-${item.kind}`}
            value={item.date}
            today={today}
            ariaLabel="Move date"
            onChange={(date) => {
              if (date) onMove(item, date);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function MonthGrid({
  selected,
  today,
  items,
  busyIssueIds,
  onSelectDay,
}: {
  selected: string;
  today: string;
  items: CalendarItemDto[];
  busyIssueIds: ReadonlySet<string>;
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
            <DroppableDate
              key={date}
              date={date}
              className={cn(
                "calendar-day-cell flex min-h-[76px] flex-col items-stretch gap-0.5 bg-card p-1",
                !inMonth && "opacity-45",
              )}
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
                <DraggableEntry key={`${item.issue.id}:${item.kind}:${item.date}`} item={item} compact busy={busyIssueIds.has(item.issue.id)} />
              ))}
              {dayItems.length > 3 && (
                <span className="px-1 text-[10px] leading-tight text-muted-foreground">+{dayItems.length - 3} more</span>
              )}
            </DroppableDate>
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
  busyIssueIds,
  onSelectDay,
}: {
  selected: string;
  today: string;
  items: CalendarItemDto[];
  busyIssueIds: ReadonlySet<string>;
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
            <DroppableDate
              key={date}
              date={date}
              className="calendar-week-col flex min-h-[160px] flex-col bg-card"
            >
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
                  <DraggableEntry key={`${item.issue.id}:${item.kind}:${item.date}`} item={item} compact={false} busy={busyIssueIds.has(item.issue.id)} />
                ))}
              </div>
            </DroppableDate>
          );
        })}
      </div>
    </div>
  );
}

function DayAgenda({
  selected,
  today,
  items,
  onMove,
}: {
  selected: string;
  today: string;
  items: CalendarItemDto[];
  onMove: (item: CalendarItemDto, date: string) => void;
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
            <li key={`${item.issue.id}:${item.kind}:${item.date}`} className="flex items-center justify-between gap-2 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <EntryLink item={item} />
              </div>
              <MoveDateControl item={item} today={today} onMove={onMove} />
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

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function CalendarViewRenderer({
  view,
  selected,
  today,
  items,
  busyIssueIds,
  onSelectDay,
  onMove,
}: {
  view: CalendarView;
  selected: string;
  today: string;
  items: CalendarItemDto[];
  /** Viewer timezone: passed through for callers that derive patches. */
  timezone: string;
  busyIssueIds: ReadonlySet<string>;
  onSelectDay: (date: string) => void;
  onMove: (item: CalendarItemDto, date: string) => void;
}) {
  const [activeItem, setActiveItem] = useState<CalendarItemDto | null>(null);
  const sensors = useSensors(
    // A movement threshold keeps plain clicks on the entry links navigable.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinatesGetter }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveItem((event.active.data.current?.item as CalendarItemDto | undefined) ?? null);
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveItem(null);
    const item = event.active.data.current?.item as CalendarItemDto | undefined;
    const date = event.over?.data.current?.date as string | undefined;
    if (item && date) onMove(item, date);
  };

  const announcementFor = (date: unknown) => {
    const d = typeof date === "string" ? date : "";
    return d ? fullDateLabel(d) : "an unknown date";
  };

  if (view === "month" && items.length === 0) {
    return <EmptyState>No planned work in this month.</EmptyState>;
  }
  if (view === "week" && items.length === 0) {
    return <EmptyState>No planned work this week.</EmptyState>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={calendarCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveItem(null)}
      accessibility={{
        announcements: {
          onDragStart({ active }) {
            const item = active.data.current?.item as CalendarItemDto | undefined;
            return item
              ? `Picked up #${item.issue.number} ${item.issue.title}. Use arrow keys to move it and space to drop.`
              : "Picked up a calendar entry.";
          },
          onDragOver({ over }) {
            return `Moved over ${announcementFor(over?.data.current?.date)}.`;
          },
          onDragEnd({ over }) {
            return `Dropped on ${announcementFor(over?.data.current?.date)}.`;
          },
          onDragCancel() {
            return "Drop cancelled.";
          },
        },
      }}
    >
        {view === "day" ? (
          <DayAgenda selected={selected} today={today} items={items} onMove={onMove} />
        ) : view === "month" ? (
          <MonthGrid
            selected={selected}
            today={today}
            items={items}
            busyIssueIds={busyIssueIds}
            onSelectDay={onSelectDay}
          />
        ) : (
          <WeekView
            selected={selected}
            today={today}
            items={items}
            busyIssueIds={busyIssueIds}
            onSelectDay={onSelectDay}
          />
        )}
      <DragOverlay dropAnimation={null}>
        {activeItem ? (
          <div className="calendar-drag-overlay cursor-grabbing rounded-md border border-border bg-card p-0.5 shadow-lg">
            <EntryLink item={activeItem} compact={view === "month"} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
