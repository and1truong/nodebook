/** Reminder editor: absolute, before-due, recurring; snooze/dismiss controls. */
import { useEffect, useState } from "react";
import { api, formatInstant } from "../api";
import type { IssueDto, ReminderDto } from "../../shared/contracts/issues";
import { Loading, ErrorState, EmptyState } from "./ui";

export function ReminderEditor({ issueRef, issue }: { issueRef: string; issue: IssueDto }) {
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
    <section className="panel">
      <h3>Reminders</h3>
      <form className="reminder-form" onSubmit={create}>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Reminder kind">
          <option value="absolute">At a specific time</option>
          <option value="before_due">Before due date</option>
          <option value="recurring">Recurring</option>
        </select>
        {kind === "absolute" && (
          <input
            type="datetime-local"
            value={triggerAt}
            onChange={(e) => setTriggerAt(e.target.value)}
            aria-label="Trigger time"
          />
        )}
        {kind === "before_due" && (
          <label className="inline">
            <input type="number" min={1} max={43200} value={offset} onChange={(e) => setOffset(Number(e.target.value))} />
            minutes before due
            {!issue.due_date && <span className="warn"> (issue has no due date yet)</span>}
          </label>
        )}
        {kind === "recurring" && (
          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} aria-label="Recurrence">
            <option value="FREQ=DAILY;INTERVAL=1">Daily</option>
            <option value="FREQ=WEEKLY;INTERVAL=1">Weekly</option>
            <option value="FREQ=MONTHLY;INTERVAL=1">Monthly</option>
          </select>
        )}
        <button type="submit" className="btn small primary" disabled={creating}>
          {creating ? "Adding…" : "Add"}
        </button>
      </form>
      {error ? <ErrorState error={error} /> : null}
      {!error && !items && <Loading label="Loading reminders…" />}
      {items && items.length === 0 && <EmptyState>No reminders.</EmptyState>}
      {items && items.length > 0 && (
        <ul className="reminder-list">
          {items.map((r) => (
            <li key={r.id} className={`reminder status-${r.status}`}>
              <span className="badge rel-type">{r.kind}</span>
              <span>{r.trigger_at ? formatInstant(r.trigger_at) : "—"}</span>
              {r.offset_minutes != null && <span className="dim">({r.offset_minutes} min before due)</span>}
              <span className={`badge status-${r.status}`}>{r.status}</span>
              <span className="reminder-actions">
                {r.status === "active" && (
                  <>
                    <button
                      className="linklike"
                      onClick={() => void update(r.id, { status: "snoozed", snooze_until: new Date(Date.now() + 60 * 60_000).toISOString() })}
                    >
                      snooze 1h
                    </button>
                    <button className="linklike" onClick={() => void update(r.id, { status: "dismissed" })}>
                      dismiss
                    </button>
                  </>
                )}
                {r.status !== "active" && (
                  <button className="linklike" onClick={() => void update(r.id, { status: "active", trigger_at: r.trigger_at ?? new Date().toISOString() })}>
                    reactivate
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
