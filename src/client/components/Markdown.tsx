/** Sanitized Markdown rendering with #123 reference links and attachment:// links. */
import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { linkifyIssueReferences, linkifyAttachmentLinks } from "../../shared/refs";
import { IssueLinkPreview } from "./IssueLinkPreview";

marked.setOptions({ gfm: true, breaks: true });

const renderer = new marked.Renderer();
renderer.table = (header, body) =>
  `<div class="markdown-table-wrap" role="region" aria-label="Scrollable table" tabindex="0"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => {
    const linked = linkifyAttachmentLinks(linkifyIssueReferences(source));
    const parsed = marked.parse(linked, { async: false, renderer }) as string;
    return DOMPurify.sanitize(parsed, { ADD_ATTR: ["target"] });
  }, [source]);

  return <IssueLinkPreview className={`markdown ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
