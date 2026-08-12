/** Reminder editor: absolute, before-due, recurring; snooze/dismiss controls. */
import { useEffect, useState } from "react";
import { api, formatInstant } from "../api";
import type { IssueDto, ReminderDto } from "../../shared/contracts/issues";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Loading, ErrorState, EmptyState } from "./ui";
import { cn } from "@/lib/utils";

const nativeSelectClass =
  "h-9 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function ReminderEditor({
  issueRef,
  issue,
  embedded = false,
}: {
  issueRef: string;
  issue: IssueDto;
  /** Compact sidebar presentation: no outer card/heading, stacked controls. */
  embedded?: boolean;
}) {
  const [items, setItems] = useState<ReminderDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [kind, setKind] = useState<"absolute" | "before_due" | "recurring">("absolute");
  const [triggerAt, setTriggerAt] = useState("");
  const [offset, setOffset] = useState(30);
  const [recurrence, setRecurrence] = useState("FREQ=DAILY;INTERVAL=1");
  const [creating, setCreating] = useState(false);

  const load = () => {
    setItems(null);
    setError(null);
    api
      .reminders(issueRef)
      .then(setItems)
      .catch(setError);
  };

  useEffect(load, [issueRef]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      if (kind === "absolute") {
        if (!triggerAt) throw new Error("Pick a date/time");
        await api.createReminder(issueRef, { kind, trigger_at: new Date(triggerAt).toISOString() });
      } else if (kind === "before_due") {
        await api.createReminder(issueRef, { kind, offset_minutes: offset });
      } else {
        await api.createReminder(issueRef, { kind, recurrence_rule: recurrence, timezone: issue.timezone });
      }
      setTriggerAt("");
      load();
    } catch (err) {
      setError(err);
    } finally {
      setCreating(false);
    }
  };

  const update = async (id: string, input: Record<string, unknown>) => {
    setError(null);
    try {
      await api.updateReminder(id, input);
      load(); // only reflect success
    } catch (err) {
      setError(err);
    }
  };

  return (
    <section className={cn("flex flex-col gap-3", !embedded && "rounded-lg border border-border bg-card p-4")}>
      {!embedded && <h3 className="text-sm font-semibold">Reminders</h3>}
      <form className={cn("reminder-form flex gap-2", embedded ? "flex-col" : "flex-wrap items-center")} onSubmit={create}>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          aria-label="Reminder kind"
          className={cn(nativeSelectClass, embedded && "w-full")}
        >
          <option value="absolute">At a specific time</option>
          <option value="before_due">Before due date</option>
          <option value="recurring">Recurring</option>
        </select>
        {kind === "absolute" && (
          <Input
            type="datetime-local"
            className={embedded ? "w-full" : "w-fit"}
            value={triggerAt}
            onChange={(e) => setTriggerAt(e.target.value)}
            aria-label="Trigger time"
          />
        )}
        {kind === "before_due" && (
          <label className={cn("flex gap-1.5 text-sm", embedded ? "flex-col items-start" : "flex-wrap items-center")}>
            <Input
              type="number"
              min={1}
              max={43200}
              className={embedded ? "w-full" : "w-24"}
              value={offset}
              onChange={(e) => setOffset(Number(e.target.value))}
            />
            <span className="flex flex-wrap items-center gap-1.5">
              minutes before due
              {!issue.due_date && <span className="warn"> (issue has no due date yet)</span>}
            </span>
          </label>
        )}
        {kind === "recurring" && (
          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
            aria-label="Recurrence"
            className={cn(nativeSelectClass, embedded && "w-full")}
          >
            <option value="FREQ=DAILY;INTERVAL=1">Daily</option>
            <option value="FREQ=WEEKLY;INTERVAL=1">Weekly</option>
            <option value="FREQ=MONTHLY;INTERVAL=1">Monthly</option>
          </select>
        )}
        <Button type="submit" size="sm" disabled={creating}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </form>
      {error ? <ErrorState error={error} /> : null}
      {!error && !items && <Loading label="Loading reminders…" />}
      {items && items.length === 0 && <EmptyState>No reminders.</EmptyState>}
      {items && items.length > 0 && (
        <ul className="flex flex-col">
          {items.map((r) => (
            <li key={r.id} className="reminder flex flex-wrap items-center gap-2 border-b border-border py-1.5 last:border-b-0">
              <Badge variant="outline" className="border-type-wiki text-type-wiki">
                {r.kind}
              </Badge>
              <span>{r.trigger_at ? formatInstant(r.trigger_at) : "—"}</span>
              {r.offset_minutes != null && <span className="dim">({r.offset_minutes} min before due)</span>}
              <Badge variant="outline" className={r.status === "active" ? "border-success text-success" : "text-muted-foreground"}>
                {r.status}
              </Badge>
              <span className="ml-auto flex gap-1">
                {r.status === "active" ? (
                  <>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-xs"
                      onClick={() =>
                        void update(r.id, { status: "snoozed", snooze_until: new Date(Date.now() + 60 * 60_000).toISOString() })
                      }
                    >
                      snooze 1h
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-xs text-destructive"
                      onClick={() => void update(r.id, { status: "dismissed" })}
                    >
                      dismiss
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0 text-xs"
                    onClick={() => void update(r.id, { status: "active", trigger_at: r.trigger_at ?? new Date().toISOString() })}
                  >
                    reactivate
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
