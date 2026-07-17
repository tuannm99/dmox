import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TreeNode } from '../datasource/types';

export function TreeView({ node, workspaceId, currentPath }: { node: TreeNode; workspaceId: string; currentPath?: string }) {
  return (
    <ul className="tree">
      {node.children?.map((child) => (
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
          {open ? '▾' : '▸'} {node.name}
        </button>
        {open && (
          <ul>
            {node.children?.map((child) => (
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
        {node.name}
      </Link>
    </li>
  );
}
