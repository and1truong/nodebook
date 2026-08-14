/**
 * Calendar: navigable day, week, and month views of planned open work (due
 * dates and scheduled instants). The visible range is fetched per view and
 * stale responses after rapid navigation are discarded. Defaults to the
 * month view of today in the viewer's timezone, Sunday-first weeks.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../api";
import { todayCivil } from "../../shared/time";
import type { CalendarItemDto } from "../../shared/contracts/issues";
import type { CalendarView } from "../calendar";
import { navigate, viewLabel, viewRange } from "../calendar";
import { CalendarViewRenderer } from "../components/CalendarView";
import { ErrorState, Loading, PageHeader } from "../components/ui";
import { Button } from "../components/ui/button";
import { cn } from "@/lib/utils";

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export function CalendarPage() {
  const [tz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [view, setView] = useState<CalendarView>("month");
  const [selected, setSelected] = useState<string>(() => todayCivil(new Date(), tz));
  const [items, setItems] = useState<CalendarItemDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const fetchSeq = useRef(0);

  const today = todayCivil(new Date(), tz);
  const range = viewRange(view, selected);

  useEffect(() => {
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
  }, [range.start, range.end, tz, reloadKey]);

  const step = (delta: number) => setSelected((cur) => navigate(view, cur, delta));
  const goToday = () => setSelected(today);

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
                  onClick={() => setView(v.value)}
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
        {viewLabel(view, selected)}
        <span className="ml-2 hidden text-xs font-normal sm:inline">
          Open work planned in <code>{tz}</code>.
        </span>
      </p>
      {error ? <ErrorState error={error} onRetry={() => setReloadKey((k) => k + 1)} /> : null}
      {!error && !items && <Loading label="Loading calendar…" />}
      {!error && items && (
        <CalendarViewRenderer
          view={view}
          selected={selected}
          today={today}
          items={items}
          onSelectDay={(date) => {
            setSelected(date);
            setView("day");
          }}
        />
      )}
    </>
  );
}
