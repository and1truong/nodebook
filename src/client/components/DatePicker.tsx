/** Themed date picker: calendar popover with Sunday-first weeks and theme tokens. */
import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "radix-ui";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]; // Sunday-first
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseIso(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y, m: mo, d };
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function DatePicker({
  id,
  value,
  min,
  today,
  onChange,
  ariaLabel,
  className,
}: {
  id?: string;
  value: string;
  min?: string;
  today: string;
  onChange: (date: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const parsed = parseIso(value);
  const todayParsed = parseIso(today);
  const [view, setView] = useState(() => ({
    y: parsed?.y ?? todayParsed?.y ?? 2000,
    m: parsed?.m ?? todayParsed?.m ?? 1,
  }));

  // Keep the editable text in sync when the stored value changes externally.
  useEffect(() => setText(value), [value]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !open) {
      const v = parseIso(value);
      if (v) setView({ y: v.y, m: v.m });
    }
    setOpen(nextOpen);
  };

  const commit = (iso: string) => {
    setText(iso);
    onChange(iso);
    setOpen(false);
  };

  const daysInMonth = new Date(view.y, view.m, 0).getDate();
  const firstDow = new Date(view.y, view.m - 1, 1).getDay(); // 0 = Sunday
  const cells: (number | null)[] = [];
  for (let i = 0; i < 42; i++) {
    const d = i - firstDow + 1;
    cells.push(d >= 1 && d <= daysInMonth ? d : null);
  }

  const isSelected = (d: number) => parsed !== null && parsed.y === view.y && parsed.m === view.m && parsed.d === d;
  const isToday = (d: number) => todayParsed !== null && todayParsed.y === view.y && todayParsed.m === view.m && todayParsed.d === d;
  const isDisabled = (d: number) => min !== undefined && toIso(view.y, view.m, d) < min;

  return (
    <div className={cn("relative w-40", className)}>
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Anchor asChild>
          <div className="relative">
            <Input
              id={id}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                const v = parseIso(e.target.value);
                if (v) onChange(toIso(v.y, v.m, v.d));
              }}
              onBlur={() => {
                if (!parseIso(text)) setText(value);
              }}
              onFocus={() => handleOpenChange(true)}
              onClick={() => handleOpenChange(true)}
              placeholder="YYYY-MM-DD"
              aria-label={ariaLabel}
              className="cursor-pointer pr-10"
            />
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label={`${ariaLabel} calendar`}
                className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CalendarDays className="size-4" />
              </button>
            </Popover.Trigger>
          </div>
        </Popover.Anchor>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={4}
          className="z-50 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center justify-between pb-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0"
              aria-label="Previous month"
              onClick={() => setView((v) => (v.m === 1 ? { y: v.y - 1, m: 12 } : { y: v.y, m: v.m - 1 }))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-semibold">
              {MONTH_NAMES[view.m - 1] ?? ""} {view.y}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0"
              aria-label="Next month"
              onClick={() => setView((v) => (v.m === 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: v.m + 1 }))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1 text-[11px] font-medium text-muted-foreground">
                {w}
              </span>
            ))}
            {cells.map((d, i) =>
              d === null ? (
                <span key={i} />
              ) : (
                <button
                  key={i}
                  type="button"
                  disabled={isDisabled(d)}
                  onClick={() => commit(toIso(view.y, view.m, d))}
                  aria-label={toIso(view.y, view.m, d)}
                  aria-pressed={isSelected(d)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center justify-self-center rounded-md text-sm transition-colors",
                    isSelected(d)
                      ? "bg-primary font-semibold text-primary-foreground"
                      : "text-foreground hover:bg-accent hover:text-accent-foreground",
                    isToday(d) && !isSelected(d) && "font-semibold text-primary",
                    isDisabled(d) && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-foreground"
                  )}
                >
                  {d}
                </button>
              )
            )}
          </div>
          {value && (
            <div className="mt-2 flex justify-end border-t border-border pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                onClick={() => {
                  onChange("");
                  setText("");
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
          )}
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
