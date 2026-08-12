/** Hierarchy tree for wiki navigation. */
import { useState } from "react";
import { Link } from "../router";
import type { WikiNodeDto } from "../../shared/contracts/issues";
import { cn } from "@/lib/utils";

export function HierarchyTree({ nodes, selectedId }: { nodes: WikiNodeDto[]; selectedId?: string | null }) {
  return (
    <ul className="tree flex flex-col gap-0.5">
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

  return (
    <li>
      <div
        className={cn("tree-row flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent", selected && "selected bg-accent")}
        style={{ paddingLeft: depth * 18 + 6 }}
      >
        {hasChildren ? (
          <button
            className="tree-toggle h-3.5 w-3.5 flex-none cursor-pointer border-0 bg-transparent p-0 text-muted-foreground"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="tree-toggle h-3.5 w-3.5 flex-none text-muted-foreground">·</span>
        )}
        <span className={`dot status-dot ${issue.status}`} />
        <Link
          to={`/wiki/${issue.number}`}
          className="tree-link truncate text-foreground hover:text-primary hover:no-underline"
        >
          <span className="issue-number font-mono text-xs text-muted-foreground">#{issue.number}</span> {issue.title}
        </Link>
      </div>
      {hasChildren && expanded && (
        <ul className="tree flex flex-col gap-0.5">
          {node.children.map((child) => (
            <TreeNode key={child.issue.id} node={child} depth={depth + 1} selectedId={selectedId} />
          ))}
        </ul>
      )}
    </li>
  );
}
