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

/** Finds the node (file or directory) at an exact path, or undefined if it no longer exists in the tree — used to resolve favorites and detect ones that have been deleted. */
export function findNodeByPath(node: TreeNode, path: string): TreeNode | undefined {
  if (node.path === path) return node;
  for (const child of node.children ?? []) {
    const found = findNodeByPath(child, path);
    if (found) return found;
  }
  return undefined;
}

export interface TreeFavoriteProps {
  isFavorite?: (path: string) => boolean;
  onToggleFavorite?: (entry: { path: string; isDir: boolean; name: string }) => void;
}

function FavoriteToggle({
  node,
  isFavorite,
  onToggleFavorite,
}: { node: TreeNode } & TreeFavoriteProps) {
  if (!onToggleFavorite) return null;
  const favorited = isFavorite?.(node.path) ?? false;
  return (
    <button
      type="button"
      className="tree-favorite-toggle"
      aria-label={favorited ? `Remove ${node.name} from favorites` : `Add ${node.name} to favorites`}
      aria-pressed={favorited}
      onClick={() => onToggleFavorite({ path: node.path, isDir: node.is_dir, name: node.name })}
    >
      {favorited ? '★' : '☆'}
    </button>
  );
}

export function TreeView({
  node,
  workspaceId,
  currentPath,
  isFavorite,
  onToggleFavorite,
}: {
  node: TreeNode;
  workspaceId: string;
  currentPath?: string;
} & TreeFavoriteProps) {
  return (
    <ul className="tree">
      {sortedChildren(node).map((child) => (
        <TreeNodeItem
          key={child.path}
          node={child}
          workspaceId={workspaceId}
          currentPath={currentPath}
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </ul>
  );
}

function TreeNodeItem({
  node,
  workspaceId,
  currentPath,
  isFavorite,
  onToggleFavorite,
}: {
  node: TreeNode;
  workspaceId: string;
  currentPath?: string;
} & TreeFavoriteProps) {
  const [open, setOpen] = useState(true);
  if (node.is_dir) {
    return (
      <li>
        <div className="tree-row">
          <button type="button" className="tree-dir" onClick={() => setOpen((o) => !o)}>
            <span className="tree-chevron" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            <span className="tree-icon" aria-hidden="true">
              {open ? '📂' : '📁'}
            </span>
            {node.name}
          </button>
          <FavoriteToggle node={node} isFavorite={isFavorite} onToggleFavorite={onToggleFavorite} />
        </div>
        {open && (
          <ul>
            {sortedChildren(node).map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                workspaceId={workspaceId}
                currentPath={currentPath}
                isFavorite={isFavorite}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }
  const active = node.path === currentPath;
  return (
    <li>
      <div className="tree-row">
        <Link className={active ? 'tree-file active' : 'tree-file'} to={`/w/${workspaceId}/doc/${node.path}`}>
          <span className="tree-icon" aria-hidden="true">
            📄
          </span>
          {node.name}
        </Link>
        <FavoriteToggle node={node} isFavorite={isFavorite} onToggleFavorite={onToggleFavorite} />
      </div>
    </li>
  );
}
