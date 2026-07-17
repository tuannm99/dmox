import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TreeView } from './TreeView';
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
  it('renders a link for each file with the correct href', () => {
    render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" />
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: 'guide.md' });
    expect(link).toHaveAttribute('href', '/w/ws/doc/local/guide.md');
  });

  it('collapses and expands a directory on click', () => {
    render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'guide.md' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /local/ }));
    expect(screen.queryByRole('link', { name: 'guide.md' })).not.toBeInTheDocument();
  });
});
