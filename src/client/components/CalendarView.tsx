/**
 * Calendar view renderers: a deployment-configured week/month grid with
 * compact issue links, seven dated week columns, and a day timeline that
 * separates timed scheduled entries from all-day due entries. Entries link to their issues;
 * keys include issue, kind, and occurrence so dual due/scheduled entries of
 * the same issue never collide.
 *
 * Creation: clicking a month/week date or a 15-minute day slot opens quick
 * create with that date/time. Dragging: entries (pointer with a movement
 * threshold, delayed touch, and keyboard) are draggable onto month cells and
 * week columns. In the day view,
 * scheduled entries are draggable onto 15-minute slots to set their time; a
 * "Move date…" picker remains available per entry. Drags only start after the
 * activation threshold, so ordinary link clicks still
 * navigate. A drag overlay, active/target styling, auto-scroll, and screen
 * reader announcements accompany the interaction.
 */
import { useEffect, useRef, useState } from "react";
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
import { civilFromInstant } from "../../shared/time";
import type { CalendarView, WeekStartDay } from "../calendar";
import { MONTH_NAMES, WEEKDAY_LONG, WEEKDAY_SHORT, addDays, isSameMonth, monthGrid, parseDate, weekday, weekDays, weekdayHeaders } from "../calendar";
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

const DAY_SLOT_MINUTES = 15;
const DAY_HEIGHT = 1_440; // one CSS pixel per minute

function scheduledMinutes(item: CalendarItemDto, timezone: string): number | null {
  if (!item.issue.scheduled_date) return null;
  const instant = new Date(item.issue.scheduled_date);
  if (Number.isNaN(instant.getTime())) return null;
  const civil = civilFromInstant(instant, timezone);
  return civil.hour * 60 + civil.minute;
}

function timeValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
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
  onCreate,
  children,
}: {
  date: string;
  className?: string;
  onCreate?: (date: string) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `date:${date}`, data: { date } });
  return (
    <div
      ref={setNodeRef}
      data-date={date}
      className={cn(
        className,
        onCreate && "cursor-pointer",
        isOver && "calendar-drop-target bg-accent/50 ring-2 ring-inset ring-primary/60",
      )}
      onClick={(event) => {
        if (!onCreate) return;
        const target = event.target as HTMLElement;
        // Links, date-header buttons, and drag handles own their clicks. Blank
        // calendar-cell space opens quick create.
        if (target.closest("a, button, input, [role='button'], .calendar-drag-handle")) return;
        onCreate(date);
      }}
    >
      {children}
    </div>
  );
}

/** A 15-minute target in the day timeline. */
function DroppableTime({
  date,
  minutes,
  onCreate,
}: {
  date: string;
  minutes: number;
  onCreate: (date: string, time: string) => void;
}) {
  const time = timeValue(minutes);
  const { setNodeRef, isOver } = useDroppable({
    id: `time:${date}:${time}`,
    data: { date, time, timeMinutes: minutes },
  });
  return (
    <div
      ref={setNodeRef}
      data-time={time}
      aria-label={`${timeLabel(minutes)} time slot`}
      title={`Create an issue at ${timeLabel(minutes)}`}
      onClick={() => onCreate(date, time)}
      className={cn(
        "calendar-time-slot absolute left-16 right-0 cursor-pointer border-t border-border/30 hover:bg-accent/40",
        minutes % 60 === 0 && "border-border/70",
        isOver && "calendar-time-drop-target z-10 bg-primary/15 ring-2 ring-inset ring-primary/60",
      )}
      style={{ top: minutes, height: DAY_SLOT_MINUTES }}
    />
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
  timeMinutes,
}: {
  item: CalendarItemDto;
  compact: boolean;
  busy: boolean;
  /** Present for a scheduled entry rendered in the day timeline. */
  timeMinutes?: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${item.issue.id}:${item.kind}:${item.date}`,
    data: { item, timeMinutes },
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

/** Move keyboard drags by semantic targets rather than fragile pixel steps.
 * Day timelines use up/down for adjacent 15-minute slots. Date grids use
 * left/right for adjacent dates and up/down for the previous/next week. */
const calendarCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

const keyboardCoordinatesGetter: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  const activeItem = context.active?.data.current?.item as CalendarItemDto | undefined;
  const overDate = context.over?.data.current?.date;
  const date = typeof overDate === "string" ? overDate : activeItem?.date;
  if (!date) return undefined;

  const overMinutes = context.over?.data.current?.timeMinutes;
  const activeMinutes = context.active?.data.current?.timeMinutes;
  const timelineMinutes = typeof overMinutes === "number" ? overMinutes : activeMinutes;
  if (typeof timelineMinutes === "number") {
    const delta = event.code === "ArrowDown" ? DAY_SLOT_MINUTES : event.code === "ArrowUp" ? -DAY_SLOT_MINUTES : 0;
    if (!delta) return undefined;
    const targetMinutes = Math.max(0, Math.min(24 * 60 - DAY_SLOT_MINUTES, timelineMinutes + delta));
    const target = context.droppableContainers
      .getEnabled()
      .find((container) => container.data.current?.date === date && container.data.current?.timeMinutes === targetMinutes);
    const targetRect = target ? context.droppableRects.get(target.id) ?? target.rect.current : undefined;
    const collisionRect = context.collisionRect;
    if (!targetRect || !collisionRect) return currentCoordinates;
    return {
      x: targetRect.left + (targetRect.width - collisionRect.width) / 2,
      y: targetRect.top + (targetRect.height - collisionRect.height) / 2,
    };
  }

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
    .find((container) => container.data.current?.date === targetDate && container.data.current?.time === undefined);
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
  weekStartDay,
  onMove,
}: {
  item: CalendarItemDto;
  today: string;
  weekStartDay: WeekStartDay;
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
            weekStartDay={weekStartDay}
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
  weekStartDay,
  onCreate,
}: {
  selected: string;
  today: string;
  items: CalendarItemDto[];
  busyIssueIds: ReadonlySet<string>;
  weekStartDay: WeekStartDay;
  onCreate: (date: string) => void;
}) {
  const grid = monthGrid(selected, weekStartDay);
  const byDate = groupByDate(items);
  return (
    <div>
      {items.length === 0 && (
        <p className="mb-2 text-sm text-muted-foreground">
          No planned work in this month. Click a date to create an issue.
        </p>
      )}
      <div className="overflow-x-auto">
        <div className="calendar-grid grid min-w-[560px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {weekdayHeaders(weekStartDay).map((w) => (
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
              onCreate={onCreate}
              className={cn(
                "calendar-day-cell flex min-h-[76px] flex-col items-stretch gap-0.5 bg-card p-1",
                !inMonth && "opacity-45",
              )}
            >
              <button
                type="button"
                onClick={() => onCreate(date)}
                title="Create an issue on this date"
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
    </div>
  );
}

function WeekView({
  selected,
  today,
  items,
  busyIssueIds,
  weekStartDay,
  onCreate,
}: {
  selected: string;
  today: string;
  items: CalendarItemDto[];
  busyIssueIds: ReadonlySet<string>;
  weekStartDay: WeekStartDay;
  onCreate: (date: string) => void;
}) {
  const days = weekDays(selected, weekStartDay);
  const byDate = groupByDate(items);
  return (
    <div>
      {items.length === 0 && (
        <p className="mb-2 text-sm text-muted-foreground">
          No planned work this week. Click a date to create an issue.
        </p>
      )}
      <div className="overflow-x-auto">
        <div className="calendar-week grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {days.map((date) => {
          const isToday = date === today;
          const dayItems = byDate.get(date) ?? [];
          return (
            <DroppableDate
              key={date}
              date={date}
              onCreate={onCreate}
              className="calendar-week-col flex min-h-[160px] flex-col bg-card"
            >
              <button
                type="button"
                onClick={() => onCreate(date)}
                title="Create an issue on this date"
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
    </div>
  );
}

function DayAgenda({
  selected,
  today,
  items,
  busyIssueIds,
  weekStartDay,
  timezone,
  onMove,
  onCreate,
}: {
  selected: string;
  today: string;
  items: CalendarItemDto[];
  busyIssueIds: ReadonlySet<string>;
  weekStartDay: WeekStartDay;
  timezone: string;
  onMove: (item: CalendarItemDto, date: string, time?: string) => void;
  onCreate: (date: string, time?: string) => void;
}) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const dayItems = groupByDate(items).get(selected) ?? [];
  const scheduled = dayItems
    .filter((i) => i.kind === "scheduled")
    .map((item) => ({ item, minutes: scheduledMinutes(item, timezone) }))
    .filter((entry): entry is { item: CalendarItemDto; minutes: number } => entry.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes || a.item.issue.number - b.item.issue.number);
  const allDay = dayItems.filter((i) => i.kind === "due");
  const firstScheduledMinute = scheduled[0]?.minutes;

  // Put the first appointment in context; empty days start at a useful
  // morning hour rather than midnight.
  useEffect(() => {
    const viewport = timelineRef.current;
    if (!viewport) return;
    viewport.scrollTop = Math.max(0, (firstScheduledMinute ?? 9 * 60) - 60);
  }, [selected, firstScheduledMinute]);

  return (
    <div>
      <section aria-label="All day">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">All day</h2>
          <Button variant="ghost" size="xs" onClick={() => onCreate(selected)}>
            + Add issue
          </Button>
        </div>
        {allDay.length === 0 ? (
          <EmptyState>Nothing is due on this day.</EmptyState>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {allDay.map((item) => (
              <li key={`${item.issue.id}:${item.kind}:${item.date}`} className="flex items-center justify-between gap-2 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <EntryLink item={item} />
                </div>
                <MoveDateControl item={item} today={today} weekStartDay={weekStartDay} onMove={onMove} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Scheduled">
        <div className="mb-2 mt-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scheduled</h2>
          <p className="text-xs text-muted-foreground">Drag an entry to a 15-minute slot to set its time.</p>
        </div>
        {scheduled.length === 0 && <EmptyState>Nothing timed is scheduled for this day.</EmptyState>}
        <div
          ref={timelineRef}
          className="calendar-day-timeline max-h-[65vh] overflow-y-auto rounded-lg border border-border bg-card"
          aria-label={`Schedule for ${fullDateLabel(selected)}`}
        >
          <div className="relative min-w-[320px]" style={{ height: DAY_HEIGHT }}>
            {Array.from({ length: 24 }, (_, hour) => (
              <span
                key={hour}
                aria-hidden="true"
                className="absolute left-0 w-14 -translate-y-1/2 pr-2 text-right font-mono text-[10px] text-muted-foreground"
                style={{ top: hour * 60 }}
              >
                {timeLabel(hour * 60).replace(":00", "")}
              </span>
            ))}
            {Array.from({ length: (24 * 60) / DAY_SLOT_MINUTES }, (_, index) => (
              <DroppableTime
                key={index}
                date={selected}
                minutes={index * DAY_SLOT_MINUTES}
                onCreate={(date, time) => onCreate(date, time)}
              />
            ))}
            {scheduled.map(({ item, minutes }, index) => (
              <div
                key={`${item.issue.id}:${item.kind}:${item.date}`}
                className="pointer-events-auto absolute left-[4.5rem] right-2 z-20 flex min-w-0 items-center gap-1 rounded-md border border-warning/40 bg-card p-0.5 shadow-sm"
                style={{ top: Math.min(minutes, DAY_HEIGHT - 46) + (index > 0 && scheduled[index - 1]?.minutes === minutes ? 6 : 0) }}
              >
                <div className="min-w-0 flex-1">
                  <DraggableEntry
                    item={item}
                    compact={false}
                    busy={busyIssueIds.has(item.issue.id)}
                    timeMinutes={Math.floor(minutes / DAY_SLOT_MINUTES) * DAY_SLOT_MINUTES}
                  />
                </div>
                <MoveDateControl item={item} today={today} weekStartDay={weekStartDay} onMove={onMove} />
              </div>
            ))}
          </div>
        </div>
      </section>
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
  weekStartDay,
  timezone,
  onCreate,
  onMove,
}: {
  view: CalendarView;
  selected: string;
  today: string;
  items: CalendarItemDto[];
  busyIssueIds: ReadonlySet<string>;
  /** Resolved first day of the calendar week. */
  weekStartDay: WeekStartDay;
  /** IANA timezone used by the calendar range and day timeline. */
  timezone: string;
  onCreate: (date: string, time?: string) => void;
  onMove: (item: CalendarItemDto, date: string, time?: string) => void;
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
    const time = event.over?.data.current?.time as string | undefined;
    if (item && date) onMove(item, date, time);
  };

  const announcementFor = (date: unknown, time?: unknown) => {
    const d = typeof date === "string" ? date : "";
    if (!d) return "an unknown date";
    const t = typeof time === "string" ? time : "";
    const minutes = t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null;
    return `${fullDateLabel(d)}${minutes !== null && Number.isFinite(minutes) ? ` at ${timeLabel(minutes)}` : ""}`;
  };

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
            return `Moved over ${announcementFor(over?.data.current?.date, over?.data.current?.time)}.`;
          },
          onDragEnd({ over }) {
            return `Dropped on ${announcementFor(over?.data.current?.date, over?.data.current?.time)}.`;
          },
          onDragCancel() {
            return "Drop cancelled.";
          },
        },
      }}
    >
        {view === "day" ? (
          <DayAgenda
            selected={selected}
            today={today}
            items={items}
            busyIssueIds={busyIssueIds}
            weekStartDay={weekStartDay}
            timezone={timezone}
            onMove={onMove}
            onCreate={onCreate}
          />
        ) : view === "month" ? (
          <MonthGrid
            selected={selected}
            today={today}
            items={items}
            busyIssueIds={busyIssueIds}
            weekStartDay={weekStartDay}
            onCreate={onCreate}
          />
        ) : (
          <WeekView
            selected={selected}
            today={today}
            items={items}
            busyIssueIds={busyIssueIds}
            weekStartDay={weekStartDay}
            onCreate={onCreate}
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
