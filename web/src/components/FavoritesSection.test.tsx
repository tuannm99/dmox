import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FavoritesSection } from './FavoritesSection';
import type { TreeNode } from '../datasource/types';
import type { FavoriteEntry } from '../useFavorites';

const tree: TreeNode = {
  name: 'WS',
  path: '',
  is_dir: true,
  children: [
    {
      name: 'local',
      path: 'local',
      is_dir: true,
      children: [
        { name: 'guide.md', path: 'local/guide.md', is_dir: false },
        { name: 'sub', path: 'local/sub', is_dir: true, children: [{ name: 'nested.md', path: 'local/sub/nested.md', is_dir: false }] },
      ],
    },
  ],
};

function renderSection(favorites: FavoriteEntry[], overrides: Partial<Parameters<typeof FavoritesSection>[0]> = {}) {
  const onToggleFavorite = vi.fn();
  const utils = render(
    <MemoryRouter>
      <FavoritesSection
        tree={tree}
        workspaceId="ws"
        favorites={favorites}
        isFavorite={(path) => favorites.some((f) => f.path === path)}
        onToggleFavorite={onToggleFavorite}
        {...overrides}
      />
    </MemoryRouter>
  );
  return { ...utils, onToggleFavorite };
}

describe('FavoritesSection', () => {
  it('renders nothing when there are no favorites', () => {
    const { container } = renderSection([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a working link for a favorited file that still exists', () => {
    renderSection([{ path: 'local/guide.md', isDir: false, name: 'guide.md' }]);
    const link = screen.getByRole('link', { name: /guide\.md/ });
    expect(link).toHaveAttribute('href', '/w/ws/doc/local/guide.md');
  });

  it('shows a Missing state with a working remove button for a favorite that no longer exists', () => {
    const { onToggleFavorite } = renderSection([{ path: 'local/deleted.md', isDir: false, name: 'deleted.md' }]);
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /deleted\.md/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onToggleFavorite).toHaveBeenCalledWith({ path: 'local/deleted.md', isDir: false, name: 'deleted.md' });
  });

  it('expands a favorited folder inline to show its children, reusing TreeView', () => {
    renderSection([{ path: 'local/sub', isDir: true, name: 'sub' }]);
    expect(screen.queryByRole('link', { name: /nested\.md/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sub/ }));
    expect(screen.getByRole('link', { name: /nested\.md/ })).toBeInTheDocument();
  });

  it('renders favorite toggles inside an expanded favorited folder too', () => {
    const { onToggleFavorite } = renderSection([{ path: 'local/sub', isDir: true, name: 'sub' }]);
    fireEvent.click(screen.getByRole('button', { name: /sub/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Add nested.md to favorites' }));
    expect(onToggleFavorite).toHaveBeenCalledWith({ path: 'local/sub/nested.md', isDir: false, name: 'nested.md' });
  });
});
