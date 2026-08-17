/** Validation, auditing, and persistence for saved Issues-page tabs. */
import type { Ctx } from "../ctx";
import type { IssueViewDto, IssueViewFilters } from "../../shared/contracts/issues";
import { issueViewFiltersSchema } from "../../shared/contracts/issues";
import { ConflictError, NotFoundError } from "../../domain/errors";
import { recordAudit } from "./audit-service";
import * as issueViewRepo from "../repositories/issue-views";

export async function listIssueViews(ctx: Ctx): Promise<IssueViewDto[]> {
  const records = await issueViewRepo.listIssueViews(ctx.env.DB);
  return records.map(toDto);
}

export async function createIssueView(
  ctx: Ctx,
  input: { name: string; filters: IssueViewFilters },
): Promise<IssueViewDto> {
  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    name: input.name,
    filters_json: JSON.stringify(input.filters),
    created_at: now,
    updated_at: now,
  };
  try {
    await issueViewRepo.insertIssueView(ctx.env.DB, record);
  } catch (error) {
    throwNameConflict(error);
  }
  const dto = toDto(record);
  await recordAudit(ctx, {
    action: "issue_view.create",
    entityType: "issue_view",
    entityId: record.id,
    after: dto,
  });
  return dto;
}

export async function updateIssueView(
  ctx: Ctx,
  id: string,
  input: { name?: string; filters?: IssueViewFilters },
): Promise<IssueViewDto> {
  const existing = await issueViewRepo.getIssueView(ctx.env.DB, id);
  if (!existing) throw new NotFoundError("Issue view not found");
  let updated;
  try {
    updated = await issueViewRepo.updateIssueView(ctx.env.DB, id, {
      name: input.name,
      filters_json: input.filters === undefined ? undefined : JSON.stringify(input.filters),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    throwNameConflict(error);
  }
  if (!updated) throw new NotFoundError("Issue view not found");
  const before = toDto(existing);
  const after = toDto(updated);
  await recordAudit(ctx, {
    action: input.name !== undefined && input.filters === undefined ? "issue_view.rename" : "issue_view.update",
    entityType: "issue_view",
    entityId: id,
    before,
    after,
  });
  return after;
}

export async function deleteIssueView(ctx: Ctx, id: string): Promise<void> {
  const existing = await issueViewRepo.getIssueView(ctx.env.DB, id);
  if (!existing) throw new NotFoundError("Issue view not found");
  if (!(await issueViewRepo.deleteIssueView(ctx.env.DB, id))) throw new NotFoundError("Issue view not found");
  await recordAudit(ctx, {
    action: "issue_view.delete",
    entityType: "issue_view",
    entityId: id,
    before: toDto(existing),
  });
}

function toDto(record: { id: string; name: string; filters_json: string; created_at: string; updated_at: string }): IssueViewDto {
  let filters: unknown;
  try {
    filters = JSON.parse(record.filters_json);
  } catch {
    filters = {};
  }
  return {
    id: record.id,
    name: record.name,
    filters: issueViewFiltersSchema.parse(filters),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function throwNameConflict(error: unknown): never {
  if (String(error).toLowerCase().includes("unique constraint failed")) {
    throw new ConflictError("An issue view with that name already exists");
  }
  throw error;
}
