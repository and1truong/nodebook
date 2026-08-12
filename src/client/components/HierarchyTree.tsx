/** Friendly, accessible hierarchy tree for wiki navigation. */
import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { Link } from "../router";
import type { WikiNodeDto } from "../../shared/contracts/issues";
import { cn } from "@/lib/utils";

export function HierarchyTree({ nodes, selectedId }: { nodes: WikiNodeDto[]; selectedId?: string | null }) {
  return (
    <ul className="tree flex flex-col gap-0.5" role="tree">
      {nodes.map((node) => (
        <TreeNode key={node.issue.id} node={node} depth={0} selectedId={selectedId} />
      ))}
    </ul>
  );
}

function TreeNode({ node, depth, selectedId }: { node: WikiNodeDto; depth: number; selectedId?: string | null }) {
  const [expanded, setExpanded] = useState(true);
  const issue = node.issue;
  const hasChildren = node.children.length > 0;
  const selected = issue.id === selectedId;
  const FolderIcon = expanded ? FolderOpen : Folder;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined} aria-selected={selected || undefined}>
      <div
        className={cn(
          "tree-row group flex min-w-0 items-center gap-1 rounded-md py-1.5 pr-2 text-sm transition-colors hover:bg-accent",
          selected && "bg-accent font-medium text-accent-foreground",
        )}
        style={{ paddingLeft: depth * 16 + 4 }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="tree-toggle flex size-5 flex-none cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground"
            onClick={() => setExpanded((value) => !value)}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${issue.title}`}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="size-5 flex-none" aria-hidden="true" />
        )}
        {hasChildren ? (
          <FolderIcon className="size-4 flex-none text-primary/80" aria-hidden="true" />
        ) : (
          <FileText className="size-4 flex-none text-muted-foreground" aria-hidden="true" />
        )}
        <Link
          to={`/wiki/${issue.number}`}
          className="tree-link min-w-0 flex-1 truncate text-foreground hover:text-foreground hover:no-underline"
          title={issue.title}
        >
          {issue.title}
        </Link>
        <span className="issue-number flex-none font-mono text-[10px] text-muted-foreground/70 group-hover:text-muted-foreground">
          #{issue.number}
        </span>
      </div>
      {hasChildren && expanded && (
        <ul className="tree flex flex-col gap-0.5" role="group">
          {node.children.map((child) => (
            <TreeNode key={child.issue.id} node={child} depth={depth + 1} selectedId={selectedId} />
          ))}
        </ul>
      )}
    </li>
  );
}
