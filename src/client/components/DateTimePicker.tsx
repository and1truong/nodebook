/** Themed date/time control that avoids the browser-owned datetime popup. */
import { useEffect, useState } from "react";
import type { WeekStartDay } from "../../shared/contracts/config";
import { DatePicker } from "./DatePicker";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";

const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parts(value: string): { date: string; time: string } {
  const match = DATE_TIME_RE.exec(value);
  return match ? { date: match[1]!, time: match[2]! } : { date: "", time: "" };
}

function currentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function DateTimePicker({
  id,
  value,
  today,
  onChange,
  ariaLabel,
  className,
  weekStartDay = "sunday",
}: {
  id?: string;
  value: string;
  today: string;
  onChange: (dateTime: string) => void;
  ariaLabel: string;
  className?: string;
  /** First day of the calendar week (default Sunday). */
  weekStartDay?: WeekStartDay;
}) {
  const parsed = parts(value);
  const [timeText, setTimeText] = useState(parsed.time);

  useEffect(() => setTimeText(parts(value).time), [value]);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <DatePicker
        id={id}
        value={parsed.date}
        today={today}
        onChange={(date) => {
          if (!date) {
            setTimeText("");
            onChange("");
            return;
          }
          const time = TIME_RE.test(timeText) ? timeText : currentTime();
          setTimeText(time);
          onChange(`${date}T${time}`);
        }}
        ariaLabel={`${ariaLabel} date`}
        className="w-40 shrink-0"
        weekStartDay={weekStartDay}
      />
      <Input
        id={id ? `${id}-time` : undefined}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={timeText}
        placeholder="HH:mm"
        aria-label={`${ariaLabel} time`}
        aria-invalid={timeText !== "" && !TIME_RE.test(timeText)}
        className="w-24 shrink-0 font-mono"
        onChange={(event) => {
          const time = event.target.value;
          setTimeText(time);
          if (parsed.date && TIME_RE.test(time)) onChange(`${parsed.date}T${time}`);
        }}
        onBlur={() => setTimeText(parts(value).time)}
      />
    </div>
  );
}
