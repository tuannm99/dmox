import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TreeNode } from '../datasource/types';

function sortedChildren(node: TreeNode): TreeNode[] {
  return [...(node.children ?? [])].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Flattens the tree into its visible file order (directories-first, alphabetical — the same order TreeView renders), for prev/next navigation. */
export function flattenLeaves(node: TreeNode): TreeNode[] {
  const leaves: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    for (const child of sortedChildren(n)) {
      if (child.is_dir) {
        walk(child);
      } else {
        leaves.push(child);
      }
    }
  };
  walk(node);
  return leaves;
}

export function TreeView({ node, workspaceId, currentPath }: { node: TreeNode; workspaceId: string; currentPath?: string }) {
  return (
    <ul className="tree">
      {sortedChildren(node).map((child) => (
        <TreeNodeItem key={child.path} node={child} workspaceId={workspaceId} currentPath={currentPath} />
      ))}
    </ul>
  );
}

function TreeNodeItem({ node, workspaceId, currentPath }: { node: TreeNode; workspaceId: string; currentPath?: string }) {
  const [open, setOpen] = useState(true);
  if (node.is_dir) {
    return (
      <li>
        <button type="button" className="tree-dir" onClick={() => setOpen((o) => !o)}>
          <span className="tree-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="tree-icon" aria-hidden="true">
            {open ? '📂' : '📁'}
          </span>
          {node.name}
        </button>
        {open && (
          <ul>
            {sortedChildren(node).map((child) => (
              <TreeNodeItem key={child.path} node={child} workspaceId={workspaceId} currentPath={currentPath} />
            ))}
          </ul>
        )}
      </li>
    );
  }
  const active = node.path === currentPath;
  return (
    <li>
      <Link className={active ? 'tree-file active' : 'tree-file'} to={`/w/${workspaceId}/doc/${node.path}`}>
        <span className="tree-icon" aria-hidden="true">
          📄
        </span>
        {node.name}
      </Link>
    </li>
  );
}
