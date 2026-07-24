import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TreeView, findNodeByPath } from './TreeView';
import type { TreeNode } from '../datasource/types';

const tree: TreeNode = {
  name: 'WS', path: '', is_dir: true,
  children: [
    {
      name: 'local', path: 'local', is_dir: true,
      children: [{ name: 'guide.md', path: 'local/guide.md', is_dir: false }],
    },
  ],
};

describe('TreeView', () => {
  it('directories are collapsed by default', () => {
    render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" />
      </MemoryRouter>
    );
    expect(screen.queryByRole('link', { name: 'guide.md' })).not.toBeInTheDocument();
  });

  it('renders a link for each file with the correct href once expanded', () => {
    render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /local/ }));
    const link = screen.getByRole('link', { name: 'guide.md' });
    expect(link).toHaveAttribute('href', '/w/ws/doc/local/guide.md');
  });

  it('collapses an expanded directory on a second click', () => {
    render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /local/ }));
    expect(screen.getByRole('link', { name: 'guide.md' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /local/ }));
    expect(screen.queryByRole('link', { name: 'guide.md' })).not.toBeInTheDocument();
  });

  it('respects isExpanded/onToggleExpanded as a controlled expand state', () => {
    const onToggleExpanded = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" isExpanded={() => false} onToggleExpanded={onToggleExpanded} />
      </MemoryRouter>
    );
    expect(screen.queryByRole('link', { name: 'guide.md' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /local/ }));
    expect(onToggleExpanded).toHaveBeenCalledWith('local');
    // controlled: clicking alone doesn't change what's rendered until isExpanded itself changes
    expect(screen.queryByRole('link', { name: 'guide.md' })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" isExpanded={(path) => path === 'local'} onToggleExpanded={onToggleExpanded} />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'guide.md' })).toBeVisible();
  });

  it('renders no favorite toggle when onToggleFavorite is not provided', () => {
    render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /favorites/i })).not.toBeInTheDocument();
  });

  it('renders a favorite toggle per row that reflects isFavorite and calls onToggleFavorite with the right entry', () => {
    const onToggleFavorite = vi.fn();
    const isFavorite = (path: string) => path === 'local/guide.md';
    render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" isFavorite={isFavorite} onToggleFavorite={onToggleFavorite} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'local' }));

    expect(screen.getByRole('button', { name: 'Remove guide.md from favorites' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add local to favorites' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add local to favorites' }));
    expect(onToggleFavorite).toHaveBeenCalledWith({ path: 'local', isDir: true, name: 'local' });
  });

  it('clicking a favorite toggle does not navigate or toggle the row it sits on', () => {
    const onToggleFavorite = vi.fn();
    render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" isFavorite={() => false} onToggleFavorite={onToggleFavorite} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'local' }));

    fireEvent.click(screen.getByRole('button', { name: 'Add local to favorites' }));
    // the directory should still be expanded (favorite click didn't also collapse it)
    expect(screen.getByRole('link', { name: 'guide.md' })).toBeVisible();
  });

  it('promotes a previewed file to a permanent tab on double click', () => {
    const onPromoteTab = vi.fn();
    render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" onPromoteTab={onPromoteTab} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /local/ }));
    fireEvent.doubleClick(screen.getByRole('link', { name: /guide\.md/ }));
    expect(onPromoteTab).toHaveBeenCalledWith('local/guide.md');
  });
});

describe('findNodeByPath', () => {
  it('finds a file node by exact path', () => {
    expect(findNodeByPath(tree, 'local/guide.md')?.name).toBe('guide.md');
  });

  it('finds a directory node by exact path', () => {
    expect(findNodeByPath(tree, 'local')?.name).toBe('local');
  });

  it('returns undefined for a path that no longer exists', () => {
    expect(findNodeByPath(tree, 'local/missing.md')).toBeUndefined();
  });

  it('badges a file with its git working-tree status, leaving unchanged files bare', () => {
    const tree = {
      name: 'WS', path: '', is_dir: true,
      children: [
        {
          name: 'local', path: 'local', is_dir: true,
          children: [
            { name: 'changed.md', path: 'local/changed.md', is_dir: false },
            { name: 'clean.md', path: 'local/clean.md', is_dir: false },
          ],
        },
      ],
    };
    const gitStatus = (path: string) => (path === 'local/changed.md' ? 'modified' : undefined);
    render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" gitStatus={gitStatus} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'local' }));

    const badge = screen.getByTitle('modified');
    expect(badge).toHaveTextContent('M');
    expect(screen.getByRole('link', { name: /changed\.md/ }).parentElement).toContainElement(badge);
    expect(screen.queryByTitle('untracked')).not.toBeInTheDocument();
  });
});
