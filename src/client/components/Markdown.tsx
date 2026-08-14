/** Sanitized Markdown rendering with #123 reference links and attachment:// links. */
import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { linkifyIssueReferences, linkifyAttachmentLinks } from "../../shared/refs";
import { IssueLinkPreview } from "./IssueLinkPreview";

marked.setOptions({ gfm: true, breaks: true });

function wrapTables(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  for (const table of template.content.querySelectorAll("table")) {
    if (table.parentElement?.classList.contains("markdown-table-wrap")) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "markdown-table-wrap";
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Scrollable table");
    wrapper.tabIndex = 0;
    table.replaceWith(wrapper);
    wrapper.appendChild(table);
  }

  return template.innerHTML;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => {
    const linked = linkifyAttachmentLinks(linkifyIssueReferences(source));
    const parsed = marked.parse(linked, { async: false }) as string;
    const sanitized = DOMPurify.sanitize(parsed, { ADD_ATTR: ["target"] });
    return wrapTables(sanitized);
  }, [source]);

  return <IssueLinkPreview className={`markdown ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
