/** Issue create/edit form: type, labels, planning fields, recurrence. */
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "../api";
import { ISSUE_TYPES, PRIORITIES, type IssueType } from "../../shared/limits";
import type { IssueDto } from "../../shared/contracts/issues";
import { buildRecurrenceRule, serializeRecurrenceRule, weekdayOfDate } from "../../shared/recurrence";
import { civilDateTimeString, instantFromCivil, parseCivilDateTime, todayCivil } from "../../shared/time";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";

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
    // The stored value is a UTC instant; render it as the wall clock of the
    // issue's timezone so an untouched field round-trips to the same instant.
    scheduled_date: issue.scheduled_date ? civilDateTimeString(new Date(issue.scheduled_date), issue.timezone) : "",
    timezone: issue.timezone,
    recurrence,
    parent_id: issue.parent_id ?? "",
  };
}

/**
 * Convert a datetime-local wall-clock value to a UTC instant in the form's
 * timezone (the inverse of the form fill in `formValuesFromIssue`). Returns
 * null when the field is empty; malformed values throw via parseCivilDateTime.
 */
export function scheduledDateToIso(values: Pick<IssueFormValues, "scheduled_date" | "timezone">): string | null {
  if (!values.scheduled_date) return null;
  const civil = parseCivilDateTime(values.scheduled_date);
  if (!civil) throw new Error("Invalid scheduled date");
  return instantFromCivil(values.timezone, civil).toISOString();
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

function planningIsEmpty(values: IssueFormValues): boolean {
  return !values.start_date && !values.due_date && !values.scheduled_date && !values.recurrence.enabled;
}

/** One-line summary of planning state, shown in the collapsed section header. */
function planningSummary(values: IssueFormValues): string {
  const parts: string[] = [];
  if (values.start_date) parts.push(`starts ${values.start_date}`);
  if (values.due_date) parts.push(`due ${values.due_date}`);
  if (values.scheduled_date) parts.push("scheduled");
  if (values.recurrence.enabled) {
    const r = values.recurrence;
    const freq = r.freq.toLowerCase();
    parts.push(r.interval > 1 ? `every ${r.interval} ${freq}s` : freq);
  }
  return parts.join(" · ");
}

/** Vertical field: visible label wired to the control via htmlFor/id. */
function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "bg-secondary text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
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
  const [titleError, setTitleError] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [allLabels, setAllLabels] = useState<string[]>([]);
  const [bodyTab, setBodyTab] = useState<"write" | "preview">("write");
  const [planningOpen, setPlanningOpen] = useState(() => !planningIsEmpty(initial));

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
      setTitleError(true);
      setError(null);
      document.getElementById("issue-title")?.focus();
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
    <form className="issue-editor mt-3 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
        {/* Main column: title + body. */}
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="Title" htmlFor="issue-title" className="w-full">
            <Input
              id="issue-title"
              value={values.title}
              onChange={(e) => {
                set("title", e.target.value);
                if (titleError) setTitleError(false);
              }}
              maxLength={500}
              autoFocus
              autoComplete="off"
              aria-invalid={titleError}
              aria-describedby={titleError ? "issue-title-error" : undefined}
            />
            <span className="flex w-full items-baseline justify-between gap-2">
              {titleError ? (
                <span id="issue-title-error" className="error-inline" role="alert">
                  Title is required.
                </span>
              ) : (
                <span />
              )}
              <span className="dim tabular-nums">{values.title.length}/500</span>
            </span>
          </Field>

          <div className="flex w-full flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="issue-body" className="text-xs font-medium text-muted-foreground">
                Body
              </Label>
              <div className="flex items-center rounded-md border border-border p-0.5" role="group" aria-label="Body editor mode">
                <TabButton active={bodyTab === "write"} onClick={() => setBodyTab("write")}>
                  Write
                </TabButton>
                <TabButton active={bodyTab === "preview"} onClick={() => setBodyTab("preview")}>
                  Preview
                </TabButton>
              </div>
            </div>
            {bodyTab === "write" ? (
              <Textarea
                id="issue-body"
                value={values.body}
                onChange={(e) => set("body", e.target.value)}
                rows={10}
                placeholder="Markdown — reference other issues with #123"
              />
            ) : (
              <div className="min-h-24 rounded-md border border-border bg-muted/40 p-3">
                {values.body.trim() ? <Markdown source={values.body} /> : <p className="hint">Nothing to preview yet.</p>}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar: type, priority, labels. */}
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <Field label="Type" htmlFor="issue-type">
            <Select value={values.type} onValueChange={(v) => set("type", v as IssueType)}>
              <SelectTrigger id="issue-type" className={selectClass} aria-label="Type">
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
          </Field>
          <Field label="Priority" htmlFor="issue-priority">
            <Select value={values.priority || "none"} onValueChange={(v) => set("priority", v === "none" ? "" : v)}>
              <SelectTrigger id="issue-priority" className={selectClass} aria-label="Priority">
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
          </Field>
          <Field label="Labels" htmlFor="label-input" className="w-full">
            <div className="label-editor flex w-full flex-col gap-1.5">
              <Input
                id="label-input"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addLabel(labelInput);
                  }
                }}
                onBlur={() => {
                  if (labelInput.trim()) addLabel(labelInput);
                }}
                placeholder="Type and press Enter"
                list="label-suggestions"
              />
              <datalist id="label-suggestions">
                {allLabels.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
              {values.labels.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {values.labels.map((l) => (
                    <span key={l} className="chip">
                      {l}
                      <button
                        type="button"
                        className="chip-x"
                        aria-label={`Remove label ${l}`}
                        onClick={() => set("labels", values.labels.filter((x) => x !== l))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Field>
        </div>
      </div>

      {/* Planning & recurrence, collapsed when empty. */}
      <section className="rounded-md border border-border">
        <button
          type="button"
          onClick={() => setPlanningOpen((o) => !o)}
          aria-expanded={planningOpen}
          aria-controls="issue-planning"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span>Planning &amp; recurrence</span>
            {!planningOpen && planningSummary(values) && (
              <span className="truncate font-normal text-muted-foreground/80">{planningSummary(values)}</span>
            )}
          </span>
          <ChevronDown className={cn("size-4 flex-none transition-transform duration-200", planningOpen && "rotate-180")} />
        </button>
        {planningOpen && (
          <div id="issue-planning" className="border-t border-border p-3">
            <PlanningFields values={values} set={set} today={today} />
          </div>
        )}
      </section>

      {values.parent_id && (
        <p className="hint">
          Parent: <a href={`/issues/${values.parent_id}`}>#{values.parent_id}</a>
        </p>
      )}

      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Field label="Start date" htmlFor="start-date">
          <Input
            id="start-date"
            type="date"
            className="w-40"
            value={values.start_date}
            min={today}
            onChange={(e) => set("start_date", e.target.value)}
          />
        </Field>
        <Field label="Due date" htmlFor="due-date">
          <Input
            id="due-date"
            type="date"
            className="w-40"
            value={values.due_date}
            onChange={(e) => set("due_date", e.target.value)}
          />
        </Field>
        <Field label="Scheduled" htmlFor="scheduled-date">
          <Input
            id="scheduled-date"
            type="datetime-local"
            className="w-56"
            value={values.scheduled_date}
            onChange={(e) => set("scheduled_date", e.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2 border-t border-dashed border-border pt-3">
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
            <Field label="Frequency" htmlFor="recurrence-freq">
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
                <SelectTrigger id="recurrence-freq" className={selectClass} aria-label="Frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">Daily</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Every">
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
            </Field>
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
            <Field label="Ends after">
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
            </Field>
          </div>
        )}
        {r.enabled && (
          <p className="hint">
            Completing this task records an occurrence and advances its planning dates instead of closing it.
          </p>
        )}
      </div>
    </div>
  );
}
