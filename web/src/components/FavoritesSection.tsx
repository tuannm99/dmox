import { Link } from 'react-router-dom';
import { TreeView, findNodeByPath, type TreeExpandProps } from './TreeView';
import type { TreeNode } from '../datasource/types';
import type { FavoriteEntry } from '../useFavorites';

export function FavoritesSection({
  tree,
  workspaceId,
  currentPath,
  favorites,
  isFavorite,
  onToggleFavorite,
  isExpanded,
  onToggleExpanded,
}: {
  tree: TreeNode;
  workspaceId: string;
  currentPath?: string;
  favorites: FavoriteEntry[];
  isFavorite: (path: string) => boolean;
  onToggleFavorite: (entry: FavoriteEntry) => void;
} & TreeExpandProps) {
  if (favorites.length === 0) return null;

  return (
    <div className="favorites-section">
      <div className="favorites-header">★ Favorites</div>
      <ul className="favorites-list">
        {favorites.map((favorite) => {
          const resolved = findNodeByPath(tree, favorite.path);
          const removeButton = (
            <button
              type="button"
              className="favorite-remove"
              aria-label={`Remove ${favorite.name} from favorites`}
              onClick={() => onToggleFavorite(favorite)}
            >
              ✕
            </button>
          );

          if (!resolved) {
            return (
              <li key={favorite.path} className="favorite-item favorite-missing">
                <span className="favorite-icon" aria-hidden="true">
                  {favorite.isDir ? '📁' : '📄'}
                </span>
                <span className="favorite-name">{favorite.name}</span>
                <span className="favorite-missing-label">Missing</span>
                {removeButton}
              </li>
            );
          }

          if (resolved.is_dir) {
            const open = isExpanded?.(favorite.path) ?? false;
            const toggleOpen = () => onToggleExpanded?.(favorite.path);
            return (
              <li key={favorite.path} className="favorite-item">
                <div className="favorite-row">
                  <button type="button" className="favorite-folder-toggle" onClick={toggleOpen}>
                    <span className="tree-chevron" aria-hidden="true">
                      {open ? '▾' : '▸'}
                    </span>
                    <span className="favorite-icon" aria-hidden="true">
                      {open ? '📂' : '📁'}
                    </span>
                    {favorite.name}
                  </button>
                  {removeButton}
                </div>
                {open && (
                  <TreeView
                    node={resolved}
                    workspaceId={workspaceId}
                    currentPath={currentPath}
                    isFavorite={isFavorite}
                    onToggleFavorite={onToggleFavorite}
                    isExpanded={isExpanded}
                    onToggleExpanded={onToggleExpanded}
                  />
                )}
              </li>
            );
          }

          const active = resolved.path === currentPath;
          return (
            <li key={favorite.path} className="favorite-item">
              <div className="favorite-row">
                <Link
                  className={active ? 'favorite-file active' : 'favorite-file'}
                  to={`/w/${workspaceId}/doc/${resolved.path}`}
                >
                  <span className="favorite-icon" aria-hidden="true">
                    📄
                  </span>
                  {favorite.name}
                </Link>
                {removeButton}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
