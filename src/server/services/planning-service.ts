/** Planning views: Inbox, Today, Upcoming, Overdue. */
import type { Ctx } from "../ctx";
import type { IssueRecord } from "../../domain/models";
import type { PlanningItemDto } from "../../shared/contracts/issues";
import { isValidTimezone, parseCivilDate, todayCivil } from "../../shared/time";
import { ValidationError } from "../../domain/errors";
import { toIssueDtos } from "./dto";
import { issueRepo } from "./issue-service";

export interface PlanningQuery {
  timezone: string;
  now: Date;
}

export function planningQuery(ctx: Ctx, tzParam: string | null | undefined): PlanningQuery {
  const timezone = tzParam && isValidTimezone(tzParam) ? tzParam : ctx.env.OWNER_TIMEZONE || "UTC";
  if (!isValidTimezone(timezone)) throw new ValidationError(`Invalid timezone: ${timezone}`);
  return { timezone, now: new Date() };
}

/**
 * All open issues regardless of workspace size. The planning predicates are
 * applied after the full set is loaded so a limit can never hide an overdue
 * or due-today item (see review: query matches before applying a limit).
 */
async function listAllOpenIssues(ctx: Ctx): Promise<IssueRecord[]> {
  const all: IssueRecord[] = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await issueRepo.listIssues(ctx.env.DB, { status: "open", limit: 500, offset });
    all.push(...batch);
    if (batch.length < 500) break;
  }
  return all;
}

/**
 * Inbox: open items without start, due, or scheduled values. By design this
 * includes child issues (the plan defines Inbox by the absence of planning
 * dates, not by tree position) and paginates through all open issues so the
 * oldest items are never truncated.
 */
export async function getInbox(ctx: Ctx): Promise<PlanningItemDto[]> {
  const open = await listAllOpenIssues(ctx);
  const items = open.filter((i) => i.start_date === null && i.due_date === null && i.scheduled_date === null);
  const dtos = await toIssueDtos(ctx, items);
  return dtos.map((d) => ({ issue: d, matched: "", matched_kind: "due" as const }));
}

/**
 * Today: open work scheduled or due in the owner's local day, plus overdue
 * work (open items whose due date has passed).
 */
export async function getToday(ctx: Ctx, tzParam?: string | null): Promise<PlanningItemDto[]> {
  const { timezone, now } = planningQuery(ctx, tzParam);
  const today = todayCivil(now, timezone);
  const issues = await listAllOpenIssues(ctx);

  const todayItems: IssueRecord[] = [];
  const overdueItems: IssueRecord[] = [];
  for (const issue of issues) {
    const matched = matchDay(issue, timezone, now, today);
    if (matched === "overdue") overdueItems.push(issue);
    else if (matched === "today") todayItems.push(issue);
  }
  const ordered = [...overdueItems, ...todayItems].sort((a, b) => {
    const key = (i: IssueRecord) => i.due_date ?? i.scheduled_date ?? i.created_at;
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  });
  const dtos = await toIssueDtos(ctx, ordered);
  return dtos.map((d) => {
    const record = ordered.find((i) => i.id === d.id);
    return {
      issue: d,
      matched: record ? (record.due_date && record.due_date < today ? record.due_date : (record.due_date ?? record.scheduled_date ?? "")) : "",
      matched_kind: record && record.due_date && record.due_date < today ? ("overdue" as const) : ("due" as const),
    };
  });
}

/**
 * Upcoming: open work scheduled or due after the owner's local day.
 */
export async function getUpcoming(ctx: Ctx, tzParam?: string | null): Promise<PlanningItemDto[]> {
  const { timezone, now } = planningQuery(ctx, tzParam);
  const today = todayCivil(now, timezone);
  const issues = await listAllOpenIssues(ctx);
  const upcoming = issues
    .filter((i) => {
      if (i.due_date && i.due_date > today) return true;
      // Compare the scheduled instant's civil date in the owner's timezone, not
      // the instant itself: a time later today belongs to Today, not Upcoming.
      if (i.scheduled_date && civilDateOf(new Date(i.scheduled_date), timezone) > today) return true;
      return false;
    })
    .sort((a, b) => {
      const key = (i: IssueRecord) => i.due_date ?? i.scheduled_date ?? "";
      return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
    });
  const dtos = await toIssueDtos(ctx, upcoming);
  return dtos.map((d) => ({
    issue: d,
    matched: d.due_date ?? d.scheduled_date ?? "",
    matched_kind: "due" as const,
  }));
}

/**
 * Overdue: open work past due (due date before the owner's local day).
 */
export async function getOverdue(ctx: Ctx, tzParam?: string | null): Promise<PlanningItemDto[]> {
  const { timezone, now } = planningQuery(ctx, tzParam);
  const today = todayCivil(now, timezone);
  const issues = await listAllOpenIssues(ctx);
  const overdue = issues
    .filter((i) => i.due_date !== null && i.due_date < today)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1));
  const dtos = await toIssueDtos(ctx, overdue);
  return dtos.map((d) => ({ issue: d, matched: d.due_date ?? "", matched_kind: "overdue" as const }));
}

function matchDay(issue: IssueRecord, timezone: string, now: Date, today: string): "today" | "overdue" | null {
  if (issue.due_date) {
    if (issue.due_date < today) return "overdue";
    if (issue.due_date === today) return "today";
  }
  if (issue.scheduled_date) {
    const scheduled = new Date(issue.scheduled_date);
    const civil = civilDateOf(scheduled, timezone);
    if (civil === today) return "today";
  }
  return null;
}

function civilDateOf(instant: Date, timezone: string): string {
  // Reuse shared helper semantics without importing civilDateString twice.
  return todayCivil(instant, timezone);
}

export function isCivilDate(value: string): boolean {
  return parseCivilDate(value) !== null;
}
