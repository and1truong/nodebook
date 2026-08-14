/**
 * Calendar: navigable day, week, and month views of planned open work (due
 * dates and scheduled instants). Opens in the deployment-configured default
 * view (CALENDAR_DEFAULT_VIEW, resolved through /api/me; fallback "week") —
 * the first range fetch waits for configuration so a temporary Week request
 * never fires when another view is configured. View switches stay
 * session-local. Clicking a month/week date or day timeline slot opens a
 * quick-create popup with its planning value prefilled. Entries can be dragged
 * between dates, while scheduled entries can also be dragged to a time in the
 * day view; moves update optimistically, are reconciled with the PATCH
 * response, and roll back with a non-destructive alert on
 * failure.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ApiError, api } from "../api";
import { todayCivil } from "../../shared/time";
import type { CalendarItemDto, IssueDto } from "../../shared/contracts/issues";
import type { CalendarView, WeekStartDay } from "../calendar";
import { navigate, reconcileCalendarItems, reschedulePatch, viewLabel, viewRange } from "../calendar";
import { CalendarViewRenderer } from "../components/CalendarView";
import { CalendarIssueDialog, type CalendarCreateTarget } from "../components/CalendarIssueDialog";
import { IssueLinkPreview } from "../components/IssueLinkPreview";
import { ErrorState, Loading, PageHeader } from "../components/ui";
import { Button } from "../components/ui/button";
import { cn } from "@/lib/utils";

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export function CalendarPage({
  defaultView,
  weekStartDay,
}: {
  defaultView?: CalendarView;
  /** Resolved week start; undefined while /api/me config is still loading. */
  weekStartDay?: WeekStartDay;
}) {
  const [tz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  // null = user has not switched; the configured default (once resolved) applies.
  const [sessionView, setSessionView] = useState<CalendarView | null>(null);
  const [selected, setSelected] = useState<string>(() => todayCivil(new Date(), tz));
  const [items, setItems] = useState<CalendarItemDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [createTarget, setCreateTarget] = useState<CalendarCreateTarget | null>(null);
  const [busyIssueIds, setBusyIssueIds] = useState<ReadonlySet<string>>(new Set());
  // State disables rendered drag handles; the ref is the synchronous lock.
  // React may not commit state between two drag-end callbacks in the same tick.
  const busyIssueIdsRef = useRef(new Set<string>());
  const fetchSeq = useRef(0);
  // A second entry of the same issue can be moved before React has committed
  // the first response DTO. Keep the last server-confirmed CAS token outside
  // render state so rapid sequential moves never reuse the old version.
  const issueVersions = useRef(new Map<string, number>());

  // null until the deployment defaults resolve (config still loading): the
  // first range fetch must wait for both the view and the week start so a
  // request for the wrong week never fires.
  const view: CalendarView | null = sessionView ?? defaultView ?? null;
  const range = view && weekStartDay ? viewRange(view, selected, weekStartDay) : null;
  // Mutation callbacks can settle after the user changes view/range. Always
  // reconcile against the range visible when each callback runs, never the
  // one captured when the drag began.
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const today = todayCivil(new Date(), tz);

  useEffect(() => {
    if (!range) return;
    const seq = ++fetchSeq.current;
    setItems(null);
    setError(null);
    api
      .calendar(range.start, range.end, tz)
      .then((next) => {
        if (fetchSeq.current === seq) {
          // Only visible issues need cached CAS tokens. Replacing rather than
          // appending bounds this map to the current calendar range.
          issueVersions.current = new Map(next.map((item) => [item.issue.id, item.issue.version]));
          setItems(next);
        }
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

  const step = (delta: number) => {
    if (!view || !weekStartDay) return;
    setSelected((cur) => navigate(view, cur, delta));
  };
  const goToday = () => setSelected(today);

  const moveEntry = useCallback(
    async (item: CalendarItemDto, targetDate: string, targetTime?: string) => {
      if (!range) return;
      const patch = reschedulePatch(item, targetDate, tz, targetTime);
      if (!patch) return; // same-date / invalid drop: no-op
      if (busyIssueIdsRef.current.has(item.issue.id)) return; // no concurrent moves per issue
      busyIssueIdsRef.current.add(item.issue.id);
      setBusyIssueIds(new Set(busyIssueIdsRef.current));
      setNotice(null);
      const reconcileVisible = (current: CalendarItemDto[] | null, issue: IssueDto) => {
        const visibleRange = rangeRef.current;
        return current && visibleRange ? reconcileCalendarItems(current, issue, visibleRange, tz) : current;
      };
      const optimistic: IssueDto = { ...item.issue, ...patch };
      setItems((prev) => reconcileVisible(prev, optimistic));
      try {
        const expectedVersion = issueVersions.current.get(item.issue.id) ?? item.issue.version;
        const updated = await api.updateIssue(String(item.issue.number), expectedVersion, patch);
        issueVersions.current.set(updated.id, updated.version);
        setItems((prev) => reconcileVisible(prev, updated));
      } catch (err) {
        if (err instanceof ApiError && err.code === "version_conflict") {
          // The pre-move DTO is stale too; refetch instead of rolling stale
          // data back over the authoritative external edit.
          setReloadKey((key) => key + 1);
        } else {
          // Roll back just this issue to its pre-move DTO in the currently
          // visible range, which may differ from the drag's original range.
          setItems((prev) => reconcileVisible(prev, item.issue));
        }
        setNotice(
          `Couldn't move "#${item.issue.number} ${item.issue.title}" — ${
            err instanceof Error ? err.message : "update failed"
          }.`,
        );
      } finally {
        busyIssueIdsRef.current.delete(item.issue.id);
        setBusyIssueIds(new Set(busyIssueIdsRef.current));
      }
    },
    [range, tz],
  );

  return (
    <>
      <PageHeader
        title="Calendar"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button variant="outline" size="sm" aria-label="Previous" disabled={!view || !weekStartDay} onClick={() => step(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToday}>
              Today
            </Button>
            <Button variant="outline" size="sm" aria-label="Next" disabled={!view || !weekStartDay} onClick={() => step(1)}>
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
        {view && weekStartDay ? viewLabel(view, selected, weekStartDay) : ""}
        <span className="ml-2 hidden text-xs font-normal sm:inline">
          Open work planned in <code>{tz}</code>. Click to create; drag entries to reschedule.
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
      {!error && items && view && weekStartDay && (
        <IssueLinkPreview>
          <CalendarViewRenderer
            view={view}
            selected={selected}
            today={today}
            items={items}
            busyIssueIds={busyIssueIds}
            weekStartDay={weekStartDay}
            timezone={tz}
            onCreate={(date, time) => setCreateTarget({ date, time })}
            onMove={moveEntry}
          />
        </IssueLinkPreview>
      )}
      {createTarget && (
        <CalendarIssueDialog
          key={`${createTarget.date}:${createTarget.time ?? "all-day"}`}
          target={createTarget}
          timezone={tz}
          onClose={() => setCreateTarget(null)}
          onCreated={(issue) => {
            issueVersions.current.set(issue.id, issue.version);
            const visibleRange = rangeRef.current;
            setItems((current) =>
              current && visibleRange ? reconcileCalendarItems(current, issue, visibleRange, tz) : current,
            );
            setCreateTarget(null);
          }}
        />
      )}
    </>
  );
}
