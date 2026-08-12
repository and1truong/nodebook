/** Issue create/edit form: type, labels, planning fields, recurrence. */
import { useEffect, useState } from "react";
import { api } from "../api";
import { ISSUE_TYPES, PRIORITIES, type IssueType } from "../../shared/limits";
import type { IssueDto } from "../../shared/contracts/issues";
import { buildRecurrenceRule, serializeRecurrenceRule, weekdayOfDate } from "../../shared/recurrence";
import { todayCivil } from "../../shared/time";

export interface IssueFormValues {
  type: IssueType;
  title: string;
  body: string;
  priority: string;
  labels: string[];
  start_date: string;
  due_date: string;
  scheduled_date: string;
  timezone: string;
  recurrence: { enabled: boolean; freq: "DAILY" | "WEEKLY" | "MONTHLY"; interval: number; byDay: string[]; count: number | null };
  parent_id: string;
}

export function emptyFormValues(): IssueFormValues {
  return {
    type: "task",
    title: "",
    body: "",
    priority: "",
    labels: [],
    start_date: "",
    due_date: "",
    scheduled_date: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    recurrence: { enabled: false, freq: "DAILY", interval: 1, byDay: [], count: null },
    parent_id: "",
  };
}

export function formValuesFromIssue(issue: IssueDto): IssueFormValues {
  const recurrence = parseRecurrenceForForm(issue.recurrence_rule);
  return {
    type: issue.type,
    title: issue.title,
    body: issue.body,
    priority: issue.priority ?? "",
    labels: issue.labels,
    start_date: issue.start_date ?? "",
    due_date: issue.due_date ?? "",
    scheduled_date: issue.scheduled_date ? issue.scheduled_date.slice(0, 16) : "",
    timezone: issue.timezone,
    recurrence,
    parent_id: issue.parent_id ?? "",
  };
}

function parseRecurrenceForForm(rule: string | null): IssueFormValues["recurrence"] {
  if (!rule) return { enabled: false, freq: "DAILY", interval: 1, byDay: [], count: null };
  const m = /^FREQ=(DAILY|WEEKLY|MONTHLY)(;INTERVAL=(\d+))?/.exec(rule);
  const byDayMatch = /;BYDAY=([A-Z,]+)/.exec(rule);
  const countMatch = /;COUNT=(\d+)/.exec(rule);
  return {
    enabled: true,
    freq: (m?.[1] as IssueFormValues["recurrence"]["freq"]) ?? "DAILY",
    interval: Number(m?.[3] ?? 1),
    byDay: byDayMatch ? byDayMatch[1]!.split(",") : [],
    count: countMatch ? Number(countMatch[1]) : null,
  };
}

export function recurrenceToRule(values: IssueFormValues): string | null {
  const r = values.recurrence;
  if (!r.enabled) return null;
  const rule = buildRecurrenceRule({
    freq: r.freq,
    interval: r.interval,
    byDay: r.freq === "WEEKLY" ? r.byDay : [],
    count: r.count && r.count > 0 ? r.count : undefined,
  });
  return serializeRecurrenceRule(rule);
}

export function IssueEditor({
  initial,
  onSubmit,
  onCancel,
  submitLabel = "Save",
}: {
  initial: IssueFormValues;
  onSubmit: (values: IssueFormValues) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<IssueFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const [allLabels, setAllLabels] = useState<string[]>([]);

  useEffect(() => {
    api
      .listIssues({ limit: "1" })
      .then(() => fetchAllLabels())
      .catch(() => undefined);
  }, []);

  const fetchAllLabels = async () => {
    try {
      const issues = await api.listIssues({ limit: "100" });
      const labels = new Set<string>();
      for (const i of issues.issues) for (const l of i.labels) labels.add(l);
      setAllLabels([...labels].sort());
    } catch {
      /* noop */
    }
  };

  const set = <K extends keyof IssueFormValues>(key: K, value: IssueFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const addLabel = (name: string) => {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) return;
    if (!values.labels.includes(trimmed)) set("labels", [...values.labels, trimmed]);
    setLabelInput("");
  };

  const today = todayCivil(new Date(), values.timezone);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  };

  return (
    <form className="issue-editor" onSubmit={submit}>
      <div className="field-row">
        <label>
          Type
          <select value={values.type} onChange={(e) => set("type", e.target.value as IssueType)}>
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={values.priority} onChange={(e) => set("priority", e.target.value)}>
            <option value="">—</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Title
        <input value={values.title} onChange={(e) => set("title", e.target.value)} maxLength={500} autoFocus />
      </label>
      <label>
        Labels
        <div className="label-editor">
          <input
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addLabel(labelInput);
              }
            }}
            placeholder="Type and press Enter"
            list="label-suggestions"
          />
          <datalist id="label-suggestions">
            {allLabels.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <div className="chips">
            {values.labels.map((l) => (
              <span key={l} className="chip">
                {l}
                <button type="button" className="chip-x" onClick={() => set("labels", values.labels.filter((x) => x !== l))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </label>
      <label>
        Body (Markdown — reference other issues with #123)
        <textarea value={values.body} onChange={(e) => set("body", e.target.value)} rows={10} />
      </label>

      <PlanningFields values={values} set={set} today={today} />

      {values.parent_id && (
        <p className="hint">
          Parent: <a href={`/issues/${values.parent_id}`}>#{values.parent_id}</a>
        </p>
      )}

      {error && <p className="error-inline">{error}</p>}
      <div className="editor-actions">
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function PlanningFields({
  values,
  set,
  today,
}: {
  values: IssueFormValues;
  set: <K extends keyof IssueFormValues>(key: K, value: IssueFormValues[K]) => void;
  today: string;
}) {
  const r = values.recurrence;
  const weekdays = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

  return (
    <fieldset className="planning-fields">
      <legend>Planning</legend>
      <div className="field-row">
        <label>
          Start date
          <input type="date" value={values.start_date} min={today} onChange={(e) => set("start_date", e.target.value)} />
        </label>
        <label>
          Due date
          <input type="date" value={values.due_date} onChange={(e) => set("due_date", e.target.value)} />
        </label>
        <label>
          Scheduled
          <input
            type="datetime-local"
            value={values.scheduled_date}
            onChange={(e) => set("scheduled_date", e.target.value)}
          />
        </label>
      </div>

      <div className="recurrence-box">
        <label className="checkline">
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => set("recurrence", { ...r, enabled: e.target.checked })}
          />
          Recurring task
        </label>
        {r.enabled && (
          <div className="field-row">
            <label>
              Frequency
              <select
                value={r.freq}
                onChange={(e) =>
                  set("recurrence", {
                    ...r,
                    freq: e.target.value as "DAILY" | "WEEKLY" | "MONTHLY",
                    byDay: e.target.value === "WEEKLY" ? (r.byDay.length ? r.byDay : [weekdayOfDate(today)]) : [],
                  })
                }
              >
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </label>
            <label>
              Every
              <input
                type="number"
                min={1}
                max={99}
                value={r.interval}
                onChange={(e) => set("recurrence", { ...r, interval: Math.max(1, Number(e.target.value) || 1) })}
              />
              {r.freq === "DAILY" && "day(s)"}
              {r.freq === "WEEKLY" && "week(s)"}
              {r.freq === "MONTHLY" && "month(s)"}
            </label>
            {r.freq === "WEEKLY" && (
              <div className="weekday-picker">
                {weekdays.map((d) => (
                  <label key={d} className="weekday">
                    <input
                      type="checkbox"
                      checked={r.byDay.includes(d)}
                      onChange={(e) =>
                        set("recurrence", {
                          ...r,
                          byDay: e.target.checked
                            ? [...r.byDay, d].sort((a, b) => weekdays.indexOf(a) - weekdays.indexOf(b))
                            : r.byDay.filter((x) => x !== d),
                        })
                      }
                    />
                    {d}
                  </label>
                ))}
              </div>
            )}
            <label>
              Ends after
              <input
                type="number"
                min={0}
                placeholder="∞"
                value={r.count ?? ""}
                onChange={(e) => set("recurrence", { ...r, count: e.target.value ? Number(e.target.value) : null })}
              />
              occurrence(s)
            </label>
          </div>
        )}
        {r.enabled && (
          <p className="hint">
            Completing this task records an occurrence and advances its planning dates instead of closing it.
          </p>
        )}
      </div>
    </fieldset>
  );
}
