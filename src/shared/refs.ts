/**
 * Issue reference (`#123`) extraction and linkification from Markdown.
 * Code blocks (``` fences) and inline code spans are excluded, so references
 * inside code are never stored or linked.
 */

const REFERENCE_RE = /(?<![\w])#(\d{1,9})\b/g;

export function extractIssueReferences(markdown: string): number[] {
  const refs = new Set<number>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (inFence) {
      if (/^\s*```/.test(line)) inFence = false;
      continue;
    }
    if (/^\s*```/.test(line)) {
      inFence = true;
      continue;
    }
    for (const m of stripInlineCode(line).matchAll(REFERENCE_RE)) {
      refs.add(parseInt(m[1]!, 10));
    }
  }
  return [...refs].sort((a, b) => a - b);
}

function stripInlineCode(line: string): string {
  let out = "";
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "`") {
      inCode = !inCode;
    } else if (!inCode) {
      out += line[i]!;
    }
  }
  return out;
}

/** Rewrite `#123` occurrences (outside code) into `[#123](/issues/123)` links. */
export function linkifyIssueReferences(markdown: string): string {
  const lines: string[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (inFence) {
      lines.push(line);
      if (/^\s*```/.test(line)) inFence = false;
      continue;
    }
    if (/^\s*```/.test(line)) {
      inFence = true;
      lines.push(line);
      continue;
    }
    lines.push(replaceRefsOutsideCode(line));
  }
  return lines.join("\n");
}

function replaceRefsOutsideCode(line: string): string {
  let out = "";
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "`") {
      inCode = !inCode;
      out += ch;
      continue;
    }
    if (!inCode && ch === "#") {
      const m = /^#(\d{1,9})\b/.exec(line.slice(i));
      if (m) {
        out += `[#${m[1]}](/issues/${m[1]})`;
        i += m[0].length - 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

const ATTACHMENT_LINK_RE = /attachment:\/\/([A-Za-z0-9-]+)(\.[A-Za-z0-9]+)?/g;

export interface AttachmentLink {
  id: string;
  extension: string;
  isImage: boolean;
}

/** Extract attachment:// references from Markdown (code-excluded). */
export function extractAttachmentLinks(markdown: string): AttachmentLink[] {
  const links: AttachmentLink[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (inFence) {
      if (/^\s*```/.test(line)) inFence = false;
      continue;
    }
    if (/^\s*```/.test(line)) {
      inFence = true;
      continue;
    }
    for (const m of stripInlineCode(line).matchAll(ATTACHMENT_LINK_RE)) {
      const extension = (m[2] ?? "").toLowerCase();
      links.push({
        id: m[1]!,
        extension,
        isImage: ["", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp"].includes(extension),
      });
    }
  }
  return links;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp"]);

/** Rewrite attachment:// links into Markdown links/images pointing at the API. */
export function linkifyAttachmentLinks(markdown: string): string {
  return markdown.replace(ATTACHMENT_LINK_RE, (match, id: string, ext?: string) => {
    const e = (ext ?? "").toLowerCase();
    if (IMAGE_EXTENSIONS.has(e)) {
      return `![${match}](/api/attachments/${id}/content)`;
    }
    return `[${match}](/api/attachments/${id}/content)`;
  });
}
