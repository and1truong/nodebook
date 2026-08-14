/** Per-issue Inbox controls for planning and completing captured work. */
import { useState } from "react";
import { CalendarDays, Check, X } from "lucide-react";
import type { IssueDto } from "../../shared/contracts/issues";
import { PRIORITIES } from "../../shared/limits";
import { addCivilMonths, todayCivil } from "../../shared/time";
import { api } from "../api";
import { DatePicker } from "./DatePicker";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function InboxItemActions({
  issue,
  timezone,
  onUpdated,
  onRemoved,
}: {
  issue: IssueDto;
  timezone: string;
  onUpdated: (issue: IssueDto) => void;
  onRemoved: (issueId: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const today = todayCivil(new Date(), timezone);
  const [customDate, setCustomDate] = useState(today);

  const updatePriority = async (priority: string) => {
    if ((issue.priority ?? "none") === priority) return;
    setPending(true);
    setError(null);
    try {
      const updated = await api.updateIssue(String(issue.number), {
        priority: priority === "none" ? null : priority,
      });
      onUpdated(updated);
    } catch (err) {
      setError(messageOf(err, "Could not update priority"));
    } finally {
      setPending(false);
    }
  };

  const assignDueDate = async (dueDate: string) => {
    setPending(true);
    setError(null);
    try {
      await api.updateIssue(String(issue.number), { due_date: dueDate });
      onRemoved(issue.id);
    } catch (err) {
      setError(messageOf(err, "Could not set due date"));
    } finally {
      setPending(false);
    }
  };

  const finish = async () => {
    setPending(true);
    setError(null);
    try {
      if (issue.type === "task") await api.completeTask(String(issue.number));
      else await api.closeIssue(String(issue.number));
      onRemoved(issue.id);
    } catch (err) {
      setError(messageOf(err, issue.type === "task" ? "Could not complete issue" : "Could not close issue"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="inbox-item-actions flex min-w-0 flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Select value={issue.priority ?? "none"} disabled={pending} onValueChange={(value) => void updatePriority(value)}>
          <SelectTrigger
            size="sm"
            className="w-[104px]"
            aria-label={`Priority for #${issue.number}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="none">No priority</SelectItem>
            {PRIORITIES.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {capitalize(priority)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              aria-label={`Plan issue #${issue.number}`}
            >
              <CalendarDays aria-hidden="true" />
              Plan
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void assignDueDate(today)}>Today</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void assignDueDate(addCivilDays(today, 1))}>Tomorrow</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void assignDueDate(addCivilDays(today, 7))}>Next week</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void assignDueDate(addCivilMonths(today, 1))}>Next month</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setCustomDate(today);
                setCustomDateOpen(true);
              }}
            >
              Pick date…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-28"
          disabled={pending}
          aria-label={`${issue.type === "task" ? "Complete" : "Close"} issue #${issue.number}`}
          onClick={() => void finish()}
        >
          {issue.type === "task" ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
          {issue.type === "task" ? "Complete" : "Close"}
        </Button>
      </div>

      {customDateOpen && (
        <div className="flex flex-wrap items-center justify-end gap-1.5 rounded-md border border-border bg-card p-1.5">
          <DatePicker
            value={customDate}
            today={today}
            onChange={setCustomDate}
            ariaLabel={`Due date for #${issue.number}`}
          />
          <Button
            type="button"
            size="sm"
            disabled={pending || !customDate}
            onClick={() => void assignDueDate(customDate)}
          >
            Apply
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setCustomDateOpen(false)}>
            Cancel
          </Button>
        </div>
      )}

      {error && (
        <p className="max-w-72 text-right text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function addCivilDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  return next.toISOString().slice(0, 10);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
