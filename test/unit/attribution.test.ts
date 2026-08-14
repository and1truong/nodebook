import { describe, expect, it } from "vitest";
import { creatorLabel } from "../../src/client/attribution";

describe("creatorLabel", () => {
  it("renders a human-friendly MCP attribution", () => {
    expect(creatorLabel({
      actor_type: "mcp",
      actor_id: "2afe957e-ae73-4a70-93bc-6181ea907307",
      user_id: "john.doe@example.com",
      email: "john.doe@example.com",
      display_name: "John Doe",
      via: "mcp",
    })).toBe("John Doe via MCP");
  });

  it("does not add a channel suffix to direct web writes", () => {
    expect(creatorLabel({
      actor_type: "human",
      actor_id: "john.doe@example.com",
      user_id: "john.doe@example.com",
      email: "john.doe@example.com",
      display_name: "John Doe",
      via: "web",
    })).toBe("John Doe");
  });
});
