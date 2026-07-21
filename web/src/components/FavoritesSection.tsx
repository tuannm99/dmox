import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TreeView, findNodeByPath } from './TreeView';
import type { TreeNode } from '../datasource/types';
import type { FavoriteEntry } from '../useFavorites';

export function FavoritesSection({
  tree,
  workspaceId,
  currentPath,
  favorites,
  isFavorite,
  onToggleFavorite,
}: {
  tree: TreeNode;
  workspaceId: string;
  currentPath?: string;
  favorites: FavoriteEntry[];
  isFavorite: (path: string) => boolean;
  onToggleFavorite: (entry: FavoriteEntry) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (favorites.length === 0) return null;

  function toggleExpanded(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  return (
    <div className="favorites-section">
      <div className="favorites-header">★ Favorites</div>
      <ul className="favorites-list">
        {favorites.map((favorite) => {
          const resolved = findNodeByPath(tree, favorite.path);
          if (!resolved) {
            return (
              <li key={favorite.path} className="favorite-item favorite-missing">
                <span className="favorite-icon" aria-hidden="true">
                  {favorite.isDir ? '📁' : '📄'}
                </span>
                <span className="favorite-name">{favorite.name}</span>
                <span className="favorite-missing-label">Missing</span>
                <button type="button" className="favorite-remove" onClick={() => onToggleFavorite(favorite)}>
                  Remove
                </button>
              </li>
            );
          }

          if (resolved.is_dir) {
            const open = expanded.has(favorite.path);
            return (
              <li key={favorite.path} className="favorite-item">
                <button type="button" className="favorite-folder-toggle" onClick={() => toggleExpanded(favorite.path)}>
                  <span className="tree-chevron" aria-hidden="true">
                    {open ? '▾' : '▸'}
                  </span>
                  <span className="favorite-icon" aria-hidden="true">
                    {open ? '📂' : '📁'}
                  </span>
                  {favorite.name}
                </button>
                {open && (
                  <TreeView
                    node={resolved}
                    workspaceId={workspaceId}
                    currentPath={currentPath}
                    isFavorite={isFavorite}
                    onToggleFavorite={onToggleFavorite}
                  />
                )}
              </li>
            );
          }

          const active = resolved.path === currentPath;
          return (
            <li key={favorite.path} className="favorite-item">
              <Link
                className={active ? 'favorite-file active' : 'favorite-file'}
                to={`/w/${workspaceId}/doc/${resolved.path}`}
              >
                <span className="favorite-icon" aria-hidden="true">
                  📄
                </span>
                {favorite.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
