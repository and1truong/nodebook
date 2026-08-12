/** Hierarchy tree for wiki navigation. */
import { useState } from "react";
import { Link } from "../router";
import type { WikiNodeDto } from "../../shared/contracts/issues";

export function HierarchyTree({ nodes, selectedId }: { nodes: WikiNodeDto[]; selectedId?: string | null }) {
  return (
    <ul className="tree">
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
      <div className={`tree-row ${selected ? "selected" : ""}`} style={{ paddingLeft: depth * 18 + 6 }}>
        {hasChildren ? (
          <button className="tree-toggle" onClick={() => setExpanded((e) => !e)} aria-label={expanded ? "Collapse" : "Expand"}>
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="tree-toggle placeholder">·</span>
        )}
        <span className={`dot status-dot ${issue.status}`} />
        <Link to={`/wiki/${issue.number}`} className="tree-link">
          <span className="issue-number">#{issue.number}</span> {issue.title}
        </Link>
      </div>
      {hasChildren && expanded && (
        <ul className="tree">
          {node.children.map((child) => (
            <TreeNode key={child.issue.id} node={child} depth={depth + 1} selectedId={selectedId} />
          ))}
        </ul>
      )}
    </li>
  );
}
