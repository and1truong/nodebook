/** Quick issue creation for a clicked calendar date or time slot. */
import { useState } from "react";
import { api } from "../api";
import { ISSUE_TYPES, type IssueType } from "../../shared/limits";
import type { IssueDto } from "../../shared/contracts/issues";
import { instantFromCivil, parseCivilDate } from "../../shared/time";
import { MONTH_NAMES, WEEKDAY_LONG, weekday } from "../calendar";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export interface CalendarCreateTarget {
  date: string;
  /** A wall-clock HH:mm value means create a scheduled issue; otherwise create an all-day due issue. */
  time?: string;
}

function dateLabel(date: string): string {
  const parts = parseCivilDate(date);
  if (!parts) return date;
  return `${WEEKDAY_LONG[weekday(date)]}, ${MONTH_NAMES[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

function timeLabel(time: string): string {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export function CalendarIssueDialog({
  target,
  timezone,
  onClose,
  onCreated,
}: {
  target: CalendarCreateTarget;
  timezone: string;
  onClose: () => void;
  onCreated: (issue: IssueDto) => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<IssueType>("task");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timed = target.time !== undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const date = parseCivilDate(target.date);
      if (!date) throw new Error("Invalid calendar date");
      let scheduledDate: string | null = null;
      if (target.time) {
        const match = /^(\d{2}):(\d{2})$/.exec(target.time);
        if (!match) throw new Error("Invalid calendar time");
        scheduledDate = instantFromCivil(timezone, {
          ...date,
          hour: Number(match[1]),
          minute: Number(match[2]),
          second: 0,
        }).toISOString();
      }
      const issue = await api.createIssue({
        title: trimmed,
        type,
        due_date: timed ? null : target.date,
        scheduled_date: scheduledDate,
        timezone,
      });
      onCreated(issue);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create issue");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>Create issue</DialogTitle>
          <DialogDescription>
            {timed
              ? `Scheduled for ${dateLabel(target.date)} at ${timeLabel(target.time!)}`
              : `Due ${dateLabel(target.date)}`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="calendar-issue-title">Title</Label>
            <Input
              id="calendar-issue-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={500}
              autoComplete="off"
              placeholder="What needs to be done?"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="calendar-issue-type">Type</Label>
            <Select value={type} onValueChange={(value) => setType(value as IssueType)}>
              <SelectTrigger id="calendar-issue-type" className="w-full" aria-label="Issue type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ISSUE_TYPES.map((issueType) => (
                  <SelectItem key={issueType} value={issueType}>
                    {issueType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p className="error-inline" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? "Creating…" : "Create issue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
