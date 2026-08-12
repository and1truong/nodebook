/** Sanitized Markdown rendering with #123 reference links and attachment:// links. */
import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { linkifyIssueReferences, linkifyAttachmentLinks } from "../../shared/refs";
import { IssueLinkPreview } from "./IssueLinkPreview";

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => {
    const linked = linkifyAttachmentLinks(linkifyIssueReferences(source));
    const parsed = marked.parse(linked, { async: false }) as string;
    return DOMPurify.sanitize(parsed, { ADD_ATTR: ["target"] });
  }, [source]);

  return <IssueLinkPreview className={`markdown ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
