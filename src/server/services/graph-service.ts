/** Issue graph: hierarchy, typed relationships, backlinks, wiki tree. */
import type { Ctx } from "../ctx";
import { ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type { IssueRecord, ReferenceRecord, RelationshipRecord } from "../../domain/models";
import type {
  BacklinkDto,
  IssueDto,
  RelationshipDto,
  SubIssueSummaryDto,
  WikiNodeDto,
} from "../../shared/contracts/issues";
import type { RelationshipType } from "../../shared/limits";
import { RELATIONSHIP_TYPES } from "../../shared/limits";
import type { IssueStatus } from "../../shared/limits";
import { recordAudit } from "./audit-service";
import {
  deleteRelationship,
  findRelationship,
  getChildren,
  getRelationshipById,
  insertRelationship,
  isInSubtree,
  listAncestors,
  listBacklinks,
  listDirectChildren,
  listLinkCandidates,
  listRelatedIssues,
  listRelationships,
} from "../repositories/graph";
import { getIssueById, getIssueByNumber, getIssueByRef, getIssueLabels, getIssuesByIds, getNumbersByIds, listIssues } from "../repositories/issues";
import { toIssueDto, toIssueDtos } from "./dto";

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

export async function setParent(ctx: Ctx, issueId: string, parentId: string | null): Promise<void> {
  const issue = await getIssueById(ctx.env.DB, issueId);
  if (!issue) throw new NotFoundError("Issue not found");

  if (parentId === null) {
    if (issue.parent_id !== null) {
      await ctx.env.DB.prepare("UPDATE issues SET parent_id = NULL, updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), issueId)
        .run();
      await recordAudit(ctx, {
        action: "issue.set_parent",
        entityType: "issue",
        entityId: issueId,
        before: { parent_id: issue.parent_id },
        after: { parent_id: null },
      });
    }
    return;
  }

  if (parentId === issueId) throw new ValidationError("An issue cannot be its own parent");
  const parent = await getIssueById(ctx.env.DB, parentId);
  if (!parent) throw new NotFoundError("Parent issue not found");

  // Cycle detection: walk upward from the would-be parent; if we reach the
  // issue itself, the new edge would create a cycle.
  const ancestors = await listAncestors(ctx.env.DB, parentId);
  if (ancestors.includes(issueId)) {
    throw new ConflictError("Setting this parent would create a cycle");
  }

  await ctx.env.DB.prepare("UPDATE issues SET parent_id = ?, updated_at = ? WHERE id = ?")
    .bind(parentId, new Date().toISOString(), issueId)
    .run();
  await recordAudit(ctx, {
    action: "issue.set_parent",
    entityType: "issue",
    entityId: issueId,
    before: { parent_id: issue.parent_id },
    after: { parent_id: parentId },
  });
}

export async function getChildrenDtos(ctx: Ctx, issueId: string): Promise<Awaited<ReturnType<typeof toIssueDtos>>> {
  const rows = await getChildren(ctx.env.DB, issueId);
  const issues: IssueRecord[] = [];
  for (const row of rows) {
    const full = await getIssueById(ctx.env.DB, row.id);
    if (full) issues.push(full);
  }
  return toIssueDtos(ctx, issues);
}

/**
 * Sub-issues, one hierarchy level per request: the direct children of
 * `rootId` as summaries carrying their own direct-child counts. Missing
 * roots 404 in the route; leaves return an empty array. Descendants load
 * lazily by requesting each branch's own direct children.
 */
export async function getDirectSubIssues(ctx: Ctx, rootId: string): Promise<SubIssueSummaryDto[]> {
  const rows = await listDirectChildren(ctx.env.DB, rootId);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status as IssueStatus,
    parent_id: row.parent_id,
    child_count: row.child_count,
    closed_child_count: row.closed_child_count,
  }));
}

/**
 * Existing-issue picker candidates: issues that may be linked under `rootId`
 * (everything except the root and its descendants, excluded server-side via a
 * recursive CTE). `q` filters title/body LIKE matches; `#123` / `123` are
 * exact number lookups merged (deduped) with the LIKE results, matching the
 * picker's previous client-side behavior. Newest issues first.
 */
export async function getSubIssueCandidates(ctx: Ctx, rootId: string, q: string, limit: number): Promise<IssueDto[]> {
  const exactNumber = /^#?(\d+)$/.exec(q.trim());
  const query = exactNumber ? null : (q.trim() || null);
  const rows = await listLinkCandidates(ctx.env.DB, rootId, query, limit);
  const ids: string[] = [];
  const seen = new Set<string>();

  if (exactNumber) {
    const hit = await getIssueByNumber(ctx.env.DB, Number(exactNumber[1]));
    if (hit && !(await isInSubtree(ctx.env.DB, rootId, hit.id))) {
      ids.push(hit.id);
      seen.add(hit.id);
    }
  }
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    ids.push(row.id);
  }
  // One batched fetch instead of a per-candidate getIssueById; ordering is
  // preserved via the ids list above.
  const byId = new Map((await getIssuesByIds(ctx.env.DB, ids)).map((issue) => [issue.id, issue]));
  const issues = ids.map((id) => byId.get(id)).filter((issue): issue is IssueRecord => issue !== undefined);
  return toIssueDtos(ctx, issues);
}

// ---------------------------------------------------------------------------
// Typed relationships
// ---------------------------------------------------------------------------

export async function addRelationship(ctx: Ctx, sourceId: string, targetId: string, type: RelationshipType): Promise<RelationshipDto> {
  if (!RELATIONSHIP_TYPES.includes(type)) throw new ValidationError(`Unknown relationship type: ${type}`);
  const source = await getIssueById(ctx.env.DB, sourceId);
  const target = await getIssueById(ctx.env.DB, targetId);
  if (!source) throw new NotFoundError("Source issue not found");
  if (!target) throw new NotFoundError("Target issue not found");
  if (sourceId === targetId) throw new ValidationError("An issue cannot relate to itself");

  const direct = await findRelationship(ctx.env.DB, sourceId, targetId, type);
  if (direct) throw new ConflictError("Relationship already exists");

  // Directional types must not exist in the opposite direction either.
  const inverse = await findRelationship(ctx.env.DB, targetId, sourceId, type);
  if (inverse) throw new ConflictError("Inverse relationship already exists");

  const now = new Date().toISOString();
  const record: RelationshipRecord = {
    id: crypto.randomUUID(),
    source_id: sourceId,
    target_id: targetId,
    type,
    created_by: actorId(ctx),
    created_at: now,
  };
  await insertRelationship(ctx.env.DB, {
    id: record.id,
    sourceId,
    targetId,
    type,
    createdBy: record.created_by,
    now,
  });
  await recordAudit(ctx, {
    action: "relationship.create",
    entityType: "relationship",
    entityId: record.id,
    after: { source_id: sourceId, source_number: source.number, target_id: targetId, target_number: target.number, type },
  });
  return toRelationshipDto(ctx, record);
}

export async function removeRelationship(ctx: Ctx, relationshipId: string): Promise<void> {
  const record = await getRelationshipById(ctx.env.DB, relationshipId);
  if (!record) throw new NotFoundError("Relationship not found");
  await deleteRelationship(ctx.env.DB, relationshipId);
  await recordAudit(ctx, {
    action: "relationship.delete",
    entityType: "relationship",
    entityId: relationshipId,
    before: { source_id: record.source_id, target_id: record.target_id, type: record.type },
  });
}

export async function getRelationshipsDtos(ctx: Ctx, issueId: string): Promise<RelationshipDto[]> {
  const records = await listRelationships(ctx.env.DB, issueId);
  const ids = new Set<string>();
  for (const r of records) {
    ids.add(r.source_id);
    ids.add(r.target_id);
  }
  const numbers = await getNumbersByIds(ctx.env.DB, [...ids]);
  const titles = await getTitlesByIds(ctx, [...ids]);
  return records.map((r) => ({
    id: r.id,
    source_id: r.source_id,
    source_number: numbers.get(r.source_id) ?? 0,
    source_title: titles.get(r.source_id) ?? "",
    target_id: r.target_id,
    target_number: numbers.get(r.target_id) ?? 0,
    target_title: titles.get(r.target_id) ?? "",
    type: r.type,
    created_by: r.created_by,
    created_at: r.created_at,
  }));
}

/** Issues related to `issueId` via any relationship (for the wiki related section). */
export async function getRelatedIssueDtos(ctx: Ctx, issueId: string): Promise<RelationshipDto[]> {
  const records = await listRelatedIssues(ctx.env.DB, issueId);
  const ids = new Set<string>();
  for (const r of records) {
    ids.add(r.source_id);
    ids.add(r.target_id);
  }
  const numbers = await getNumbersByIds(ctx.env.DB, [...ids]);
  const titles = await getTitlesByIds(ctx, [...ids]);
  return records
    .filter((r) => r.source_id !== issueId || r.target_id !== issueId)
    .map((r) => ({
      id: r.id,
      source_id: r.source_id,
      source_number: numbers.get(r.source_id) ?? 0,
      source_title: titles.get(r.source_id) ?? "",
      target_id: r.target_id,
      target_number: numbers.get(r.target_id) ?? 0,
      target_title: titles.get(r.target_id) ?? "",
      type: r.type,
      created_by: r.created_by,
      created_at: r.created_at,
    }));
}

async function getTitlesByIds(ctx: Ctx, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const res = await ctx.env.DB.prepare(`SELECT id, title FROM issues WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ id: string; title: string }>();
  for (const row of res.results) map.set(row.id, row.title);
  return map;
}

async function toRelationshipDto(ctx: Ctx, record: RelationshipRecord): Promise<RelationshipDto> {
  const [source, target, numbers] = await Promise.all([
    getIssueById(ctx.env.DB, record.source_id),
    getIssueById(ctx.env.DB, record.target_id),
    getNumbersByIds(ctx.env.DB, [record.source_id, record.target_id]),
  ]);
  return {
    id: record.id,
    source_id: record.source_id,
    source_number: numbers.get(record.source_id) ?? 0,
    source_title: source?.title ?? "",
    target_id: record.target_id,
    target_number: numbers.get(record.target_id) ?? 0,
    target_title: target?.title ?? "",
    type: record.type,
    created_by: record.created_by,
    created_at: record.created_at,
  };
}

// ---------------------------------------------------------------------------
// Backlinks
// ---------------------------------------------------------------------------

export async function getBacklinkDtos(ctx: Ctx, issueId: string): Promise<BacklinkDto[]> {
  const issue = await getIssueById(ctx.env.DB, issueId);
  if (!issue) throw new NotFoundError("Issue not found");
  const records = await listBacklinks(ctx.env.DB, issueId);
  const dtos: BacklinkDto[] = [];
  for (const r of records) {
    dtos.push(await toBacklinkDto(ctx, r));
  }
  return dtos;
}

async function toBacklinkDto(ctx: Ctx, record: ReferenceRecord): Promise<BacklinkDto> {
  if (record.source_type === "issue") {
    const source = await getIssueById(ctx.env.DB, record.source_id);
    return {
      id: record.id,
      source_type: record.source_type,
      source_id: record.source_id,
      source_number: source?.number ?? null,
      source_title: source?.title ?? null,
      target_number: record.target_number,
      created_at: record.created_at,
    };
  }
  const comment = await ctx.env.DB.prepare("SELECT issue_id FROM comments WHERE id = ?").bind(record.source_id).first<{ issue_id: string }>();
  if (!comment) {
    return {
      id: record.id,
      source_type: record.source_type,
      source_id: record.source_id,
      source_number: null,
      source_title: null,
      target_number: record.target_number,
      created_at: record.created_at,
    };
  }
  const sourceIssue = await getIssueById(ctx.env.DB, comment.issue_id);
  return {
    id: record.id,
    source_type: record.source_type,
    source_id: record.source_id,
    source_number: sourceIssue?.number ?? null,
    source_title: sourceIssue ? `Comment on #${sourceIssue.number} ${sourceIssue.title}` : null,
    target_number: record.target_number,
    created_at: record.created_at,
  };
}

// ---------------------------------------------------------------------------
// Wiki tree
// ---------------------------------------------------------------------------

/**
 * Full hierarchy tree of wiki pages (used by the wiki navigation). Only
 * root issues of type `wiki` are top-level entries; descendants may keep any
 * issue type. Branches beneath excluded (non-wiki) roots are not promoted.
 */
export async function getWikiTree(ctx: Ctx): Promise<WikiNodeDto[]> {
  const roots = await listIssues(ctx.env.DB, { parent_id: null, type: "wiki", limit: 500 });
  const nodes = await Promise.all(roots.map((root) => buildWikiNode(ctx, root)));
  return nodes;
}

async function buildWikiNode(ctx: Ctx, issue: IssueRecord): Promise<WikiNodeDto> {
  const dto = await toIssueDto(ctx, issue);
  const children = await getChildren(ctx.env.DB, issue.id);
  const childIssues: IssueRecord[] = [];
  for (const c of children) {
    const full = await getIssueById(ctx.env.DB, c.id);
    if (full) childIssues.push(full);
  }
  const childNodes = await Promise.all(childIssues.map((c) => buildWikiNode(ctx, c)));
  return { issue: dto, children: childNodes };
}

/** Breadcrumbs: root → … → issue. */
export async function getBreadcrumbs(ctx: Ctx, issueId: string): Promise<{ id: string; number: number; title: string }[]> {
  const chain: { id: string; number: number; title: string }[] = [];
  let current: string | null = issueId;
  let guard = 0;
  while (current && guard < 100) {
    const issue = await getIssueById(ctx.env.DB, current);
    if (!issue) break;
    chain.unshift({ id: issue.id, number: issue.number, title: issue.title });
    current = issue.parent_id;
    guard += 1;
  }
  return chain;
}

function actorId(ctx: Ctx): string {
  return ctx.actor.type === "human" ? ctx.actor.id : `${ctx.actor.type}:${ctx.actor.id}`;
}

/** Resolve a `ref` (uuid or number) to a full issue or throw. */
export async function getIssueByRefOrThrow(ctx: Ctx, ref: string): Promise<IssueRecord> {
  const issue = await getIssueByRef(ctx.env.DB, ref);
  if (!issue) throw new NotFoundError(`Issue ${ref} not found`);
  return issue;
}

export { getIssueByNumber, getIssueLabels };
