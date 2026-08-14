import type { CreatorAttributionDto } from "../shared/contracts/issues";

/** Human-facing label while keeping raw actor ids available in the DTO. */
export function creatorLabel(creator: CreatorAttributionDto): string {
  return creator.via === "mcp"
    ? `${creator.display_name} via MCP`
    : creator.display_name;
}
