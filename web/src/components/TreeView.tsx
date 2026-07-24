import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TreeNode } from '../datasource/types';
import { statusLetter } from '../useGitStatus';

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

export interface TreeExpandProps {
  isExpanded?: (path: string) => boolean;
  onToggleExpanded?: (path: string) => void;
}

export interface TreeGitProps {
  /** Working-tree status for a path, or undefined when it is unchanged (or
   *  the source isn't in a git checkout at all). */
  gitStatus?: (path: string) => string | undefined;
}

function GitBadge({ node, gitStatus }: { node: TreeNode } & TreeGitProps) {
  const status = gitStatus?.(node.path);
  if (!status) return null;
  return (
    <span className={`git-status-badge git-status-${status}`} title={status}>
      {statusLetter(status)}
    </span>
  );
}

export interface TreeTabProps {
  /** Double-clicking a file turns its reusable preview tab into a permanent one. */
  onPromoteTab?: (path: string) => void;
}

export function TreeView({
  node,
  workspaceId,
  currentPath,
  isFavorite,
  onToggleFavorite,
  isExpanded,
  onToggleExpanded,
  gitStatus,
  onPromoteTab,
}: {
  node: TreeNode;
  workspaceId: string;
  currentPath?: string;
} & TreeFavoriteProps &
  TreeExpandProps &
  TreeGitProps &
  TreeTabProps) {
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
          isExpanded={isExpanded}
          onToggleExpanded={onToggleExpanded}
          gitStatus={gitStatus}
          onPromoteTab={onPromoteTab}
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
  isExpanded,
  onToggleExpanded,
  gitStatus,
  onPromoteTab,
}: {
  node: TreeNode;
  workspaceId: string;
  currentPath?: string;
} & TreeFavoriteProps &
  TreeExpandProps &
  TreeGitProps &
  TreeTabProps) {
  // Uncontrolled fallback (no isExpanded/onToggleExpanded passed) still
  // defaults to collapsed, matching the controlled default — nothing about
  // "not persisted" should mean "open by default".
  const [localOpen, setLocalOpen] = useState(false);
  const open = isExpanded ? isExpanded(node.path) : localOpen;
  const toggleOpen = () => {
    if (onToggleExpanded) {
      onToggleExpanded(node.path);
    } else {
      setLocalOpen((o) => !o);
    }
  };

  if (node.is_dir) {
    return (
      <li>
        <div className="tree-row">
          <button type="button" className="tree-dir" onClick={toggleOpen}>
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
                isExpanded={isExpanded}
                onToggleExpanded={onToggleExpanded}
                gitStatus={gitStatus}
                onPromoteTab={onPromoteTab}
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
        <Link
          className={active ? 'tree-file active' : 'tree-file'}
          to={`/w/${workspaceId}/doc/${node.path}`}
          state={{ preview: true }}
          onDoubleClick={() => onPromoteTab?.(node.path)}
        >
          <span className="tree-icon" aria-hidden="true">
            📄
          </span>
          {node.name}
        </Link>
        <GitBadge node={node} gitStatus={gitStatus} />
        <FavoriteToggle node={node} isFavorite={isFavorite} onToggleFavorite={onToggleFavorite} />
      </div>
    </li>
  );
}
