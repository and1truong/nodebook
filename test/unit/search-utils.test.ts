import { describe, expect, it } from "vitest";
import { cleanSnippet, escapeFtsQuery, hasSearchableTerms } from "../../src/server/services/search-utils";

describe("escapeFtsQuery", () => {
  it("quotes terms and joins with implicit AND", () => {
    expect(escapeFtsQuery("hello world")).toBe('"hello" "world"');
  });

  it("strips punctuation and FTS operators", () => {
    expect(escapeFtsQuery('alpha "beta" gamma-2')).toBe('"alpha" "beta" "gamma" "2"');
    expect(escapeFtsQuery("NOT OR AND NEAR")).toBe('"NOT" "OR" "AND" "NEAR"');
  });

  it("handles empty and punctuation-only queries", () => {
    expect(escapeFtsQuery("")).toBe('""');
    expect(escapeFtsQuery("!!! ???")).toBe('""');
  });

  it("detects searchable terms", () => {
    expect(hasSearchableTerms("hello")).toBe(true);
    expect(hasSearchableTerms("")).toBe(false);
    expect(hasSearchableTerms(" .,;!? ")).toBe(false);
  });
});

describe("cleanSnippet", () => {
  it("strips FTS5 highlight markers", () => {
    expect(cleanSnippet("a [hello] world [hello]")).toBe("a hello world hello");
  });

  it("collapses whitespace", () => {
    expect(cleanSnippet("line1\n  line2")).toBe("line1 line2");
  });

  it("handles null", () => {
    expect(cleanSnippet(null)).toBe("");
  });
});
