/** Issue create/edit form: type, labels, planning fields, recurrence. */
import { useEffect, useState } from "react";
import { api } from "../api";
import { ISSUE_TYPES, PRIORITIES, type IssueType } from "../../shared/limits";
import type { IssueDto } from "../../shared/contracts/issues";
import { buildRecurrenceRule, serializeRecurrenceRule, weekdayOfDate } from "../../shared/recurrence";
import { todayCivil } from "../../shared/time";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

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

const selectClass = "w-40";

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
    <form className="issue-editor mt-3 flex flex-col gap-3.5 rounded-lg border border-border bg-card p-5" onSubmit={submit}>
      <div className="flex flex-wrap gap-3">
        <Label className="flex flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
          Type
          <Select value={values.type} onValueChange={(v) => set("type", v as IssueType)}>
            <SelectTrigger className={selectClass} aria-label="Type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ISSUE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
        <Label className="flex flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
          Priority
          <Select value={values.priority || "none"} onValueChange={(v) => set("priority", v === "none" ? "" : v)}>
            <SelectTrigger className={selectClass} aria-label="Priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
      </div>
      <Label className="flex w-full flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
        <span>Title</span>
        <Input value={values.title} onChange={(e) => set("title", e.target.value)} maxLength={500} autoFocus />
      </Label>
      <Label className="flex w-full flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
        <span>Labels</span>
        <div className="label-editor flex w-full flex-col gap-1.5">
          <Input
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
          <div className="flex flex-wrap gap-1">
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
      </Label>
      <Label className="flex w-full flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
        <span>Body (Markdown — reference other issues with #123)</span>
        <Textarea value={values.body} onChange={(e) => set("body", e.target.value)} rows={10} />
      </Label>

      <PlanningFields values={values} set={set} today={today} />

      {values.parent_id && (
        <p className="hint">
          Parent: <a href={`/issues/${values.parent_id}`}>#{values.parent_id}</a>
        </p>
      )}

      {error && <p className="error-inline">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
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
    <fieldset className="flex flex-col gap-2.5 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-semibold text-muted-foreground">Planning</legend>
      <div className="flex flex-wrap gap-3">
        <Label className="flex flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
          <span>Start date</span>
          <Input type="date" value={values.start_date} min={today} onChange={(e) => set("start_date", e.target.value)} />
        </Label>
        <Label className="flex flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
          <span>Due date</span>
          <Input type="date" value={values.due_date} onChange={(e) => set("due_date", e.target.value)} />
        </Label>
        <Label className="flex flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
          <span>Scheduled</span>
          <Input
            type="datetime-local"
            value={values.scheduled_date}
            onChange={(e) => set("scheduled_date", e.target.value)}
          />
        </Label>
      </div>

      <div className="flex flex-col gap-2 border-t border-dashed border-border pt-2.5">
        <Label className="flex flex-row items-center gap-1.5 text-sm text-foreground">
          <input
            type="checkbox"
            className="accent-primary"
            checked={r.enabled}
            onChange={(e) => set("recurrence", { ...r, enabled: e.target.checked })}
          />
          Recurring task
        </Label>
        {r.enabled && (
          <div className="flex flex-wrap gap-3">
            <Label className="flex flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
              Frequency
              <Select
                value={r.freq}
                onValueChange={(v) =>
                  set("recurrence", {
                    ...r,
                    freq: v as "DAILY" | "WEEKLY" | "MONTHLY",
                    byDay: v === "WEEKLY" ? (r.byDay.length ? r.byDay : [weekdayOfDate(today)]) : [],
                  })
                }
              >
                <SelectTrigger className={selectClass} aria-label="Frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">Daily</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            <Label className="flex flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
              Every
              <div className="flex items-center gap-1.5 text-sm">
                <Input
                  type="number"
                  min={1}
                  max={99}
                  className="w-20"
                  value={r.interval}
                  onChange={(e) => set("recurrence", { ...r, interval: Math.max(1, Number(e.target.value) || 1) })}
                />
                {r.freq === "DAILY" && "day(s)"}
                {r.freq === "WEEKLY" && "week(s)"}
                {r.freq === "MONTHLY" && "month(s)"}
              </div>
            </Label>
            {r.freq === "WEEKLY" && (
              <div className="flex items-center gap-1">
                {weekdays.map((d) => (
                  <Label key={d} className="flex flex-row items-center gap-1 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      className="accent-primary"
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
                  </Label>
                ))}
              </div>
            )}
            <Label className="flex flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
              Ends after
              <div className="flex items-center gap-1.5 text-sm">
                <Input
                  type="number"
                  min={0}
                  placeholder="∞"
                  className="w-20"
                  value={r.count ?? ""}
                  onChange={(e) => set("recurrence", { ...r, count: e.target.value ? Number(e.target.value) : null })}
                />
                occurrence(s)
              </div>
            </Label>
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
