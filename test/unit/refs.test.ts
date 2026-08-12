import { describe, expect, it } from "vitest";
import {
  extractAttachmentLinks,
  extractIssueReferences,
  linkifyAttachmentLinks,
  linkifyIssueReferences,
} from "../../src/shared/refs";

describe("extractIssueReferences", () => {
  it("extracts simple references", () => {
    expect(extractIssueReferences("See #12 and #3 for context")).toEqual([3, 12]);
  });

  it("deduplicates", () => {
    expect(extractIssueReferences("#1 #1 #2")).toEqual([1, 2]);
  });

  it("excludes fenced code blocks", () => {
    const md = "Refer to #1\n\n```\nconst x = \"#2\";\n#3\n```\n\nAfter: #4";
    expect(extractIssueReferences(md)).toEqual([1, 4]);
  });

  it("excludes inline code spans", () => {
    const md = "Use `#1` here, and #2 there";
    expect(extractIssueReferences(md)).toEqual([2]);
  });

  it("does not match longer hashes like hex colors or headings with space", () => {
    expect(extractIssueReferences("#123abc and ## 99")).toEqual([]);
    expect(extractIssueReferences("## Heading")).toEqual([]);
  });

  it("matches inside parentheses and punctuation", () => {
    expect(extractIssueReferences("(see #42!)")).toEqual([42]);
  });

  it("does not match part of a word", () => {
    expect(extractIssueReferences("abc#12")).toEqual([]);
  });
});

describe("linkifyIssueReferences", () => {
  it("wraps references in links outside code", () => {
    const out = linkifyIssueReferences("Fix #7\n\n```\n#8\n```\n`#9`");
    expect(out).toContain("[#7](/issues/7)");
    expect(out).toContain("```\n#8\n```");
    expect(out).toContain("`#9`");
  });
});

describe("extractAttachmentLinks", () => {
  it("extracts attachment ids", () => {
    expect(extractAttachmentLinks("see attachment://abc-123.png for details")).toEqual([
      { id: "abc-123", extension: ".png", isImage: true },
    ]);
  });

  it("flags non-image extensions as non-image", () => {
    expect(extractAttachmentLinks("attachment://xyz.zip")[0]).toMatchObject({ id: "xyz", isImage: false });
  });

  it("excludes code blocks", () => {
    expect(extractAttachmentLinks("```\nattachment://hidden\n```\nattachment://shown")).toHaveLength(1);
  });
});

describe("linkifyAttachmentLinks", () => {
  it("turns images into markdown images", () => {
    expect(linkifyAttachmentLinks("attachment://img-1.png")).toBe("![attachment://img-1.png](/api/attachments/img-1/content)");
  });
  it("turns other files into links", () => {
    expect(linkifyAttachmentLinks("attachment://doc.pdf")).toBe("[attachment://doc.pdf](/api/attachments/doc/content)");
  });
});
