/**
 * Calendar: navigable day, week, and month views of planned open work (due
 * dates and scheduled instants). Opens in the deployment-configured default
 * view (CALENDAR_DEFAULT_VIEW, resolved through /api/me; fallback "week") —
 * the first range fetch waits for configuration so a temporary Week request
 * never fires when another view is configured. View switches stay
 * session-local. Entries can be dragged between dates (or moved with the
 * day-view "Move date…" picker); moves update optimistically, are reconciled
 * with the PATCH response, and roll back with a non-destructive alert on
 * failure.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../api";
import { todayCivil } from "../../shared/time";
import type { CalendarItemDto, IssueDto } from "../../shared/contracts/issues";
import type { CalendarView } from "../calendar";
import { navigate, reconcileCalendarItems, reschedulePatch, viewLabel, viewRange } from "../calendar";
import { CalendarViewRenderer } from "../components/CalendarView";
import { ErrorState, Loading, PageHeader } from "../components/ui";
import { Button } from "../components/ui/button";
import { cn } from "@/lib/utils";

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export function CalendarPage({ defaultView }: { defaultView?: CalendarView }) {
  const [tz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  // null = user has not switched; the configured default (once resolved) applies.
  const [sessionView, setSessionView] = useState<CalendarView | null>(null);
  const [selected, setSelected] = useState<string>(() => todayCivil(new Date(), tz));
  const [items, setItems] = useState<CalendarItemDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyIssueIds, setBusyIssueIds] = useState<ReadonlySet<string>>(new Set());
  const fetchSeq = useRef(0);

  // null until the deployment default resolves (config still loading).
  const view: CalendarView | null = sessionView ?? defaultView ?? null;
  const range = view ? viewRange(view, selected) : null;
  const today = todayCivil(new Date(), tz);

  useEffect(() => {
    if (!range) return;
    const seq = ++fetchSeq.current;
    setItems(null);
    setError(null);
    api
      .calendar(range.start, range.end, tz)
      .then((next) => {
        if (fetchSeq.current === seq) setItems(next);
      })
      .catch((err) => {
        if (fetchSeq.current === seq) setError(err);
      });
    return () => {
      // Invalidate a still-pending fetch so a slower earlier response can
      // never overwrite the view after rapid navigation.
      if (fetchSeq.current === seq) fetchSeq.current++;
    };
  }, [range?.start, range?.end, tz, reloadKey]);

  const step = (delta: number) => setSelected((cur) => navigate(view ?? "week", cur, delta));
  const goToday = () => setSelected(today);

  const moveEntry = useCallback(
    async (item: CalendarItemDto, targetDate: string) => {
      if (!range) return;
      const patch = reschedulePatch(item, targetDate, tz);
      if (!patch) return; // same-date / invalid drop: no-op
      if (busyIssueIds.has(item.issue.id)) return; // no concurrent moves per issue
      setBusyIssueIds((prev) => new Set(prev).add(item.issue.id));
      setNotice(null);
      const optimistic: IssueDto = { ...item.issue, ...patch };
      setItems((prev) => (prev ? reconcileCalendarItems(prev, optimistic, range, tz) : prev));
      try {
        const updated = await api.updateIssue(String(item.issue.number), patch);
        setItems((prev) => (prev ? reconcileCalendarItems(prev, updated, range, tz) : prev));
      } catch (err) {
        // Roll back just this issue to its pre-move DTO.
        setItems((prev) => (prev ? reconcileCalendarItems(prev, item.issue, range, tz) : prev));
        setNotice(
          `Couldn't move "#${item.issue.number} ${item.issue.title}" — ${
            err instanceof Error ? err.message : "update failed"
          }.`,
        );
      } finally {
        setBusyIssueIds((prev) => {
          const next = new Set(prev);
          next.delete(item.issue.id);
          return next;
        });
      }
    },
    [range, tz, busyIssueIds],
  );

  return (
    <>
      <PageHeader
        title="Calendar"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button variant="outline" size="sm" aria-label="Previous" onClick={() => step(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToday}>
              Today
            </Button>
            <Button variant="outline" size="sm" aria-label="Next" onClick={() => step(1)}>
              <ChevronRight className="size-4" />
            </Button>
            <div role="group" aria-label="View" className="ml-1 flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
              {VIEWS.map((v) => (
                <Button
                  key={v.value}
                  variant="ghost"
                  size="sm"
                  aria-pressed={view === v.value}
                  onClick={() => setSessionView(v.value)}
                  className={cn("h-7 px-2.5 text-xs", view === v.value && "bg-accent font-semibold text-accent-foreground")}
                >
                  {v.label}
                </Button>
              ))}
            </div>
          </div>
        }
      />
      <p className="mb-3 text-sm font-medium text-muted-foreground" aria-live="polite">
        {view ? viewLabel(view, selected) : ""}
        <span className="ml-2 hidden text-xs font-normal sm:inline">
          Open work planned in <code>{tz}</code>. Drag entries to reschedule.
        </span>
      </p>
      {notice && (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
        >
          <span>{notice}</span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Dismiss notice"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </Button>
        </div>
      )}
      {error ? <ErrorState error={error} onRetry={() => setReloadKey((k) => k + 1)} /> : null}
      {!error && !items && <Loading label="Loading calendar…" />}
      {!error && items && view && (
        <CalendarViewRenderer
          view={view}
          selected={selected}
          today={today}
          items={items}
          timezone={tz}
          busyIssueIds={busyIssueIds}
          onSelectDay={(date) => {
            setSelected(date);
            setSessionView("day");
          }}
          onMove={moveEntry}
        />
      )}
    </>
  );
}
