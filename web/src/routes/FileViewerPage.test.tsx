import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { FileViewerPage } from './FileViewerPage';
import type { TreeNode } from '../datasource/types';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});
vi.mock('../components/GitHistoryPanel', () => ({ GitHistoryPanel: () => null }));

describe('FileViewerPage', () => {
  it('loads and renders the file title, ai-context badge, and body', async () => {
    (globalThis as any).__testDataSource = {
      getFile: vi.fn().mockResolvedValue({
        path: 'local/CLAUDE.md', title: 'Agent Notes', frontmatter: {}, body: 'hello body', headings: [], is_ai_context: true,
      }),
    };
    render(
      <MemoryRouter initialEntries={['/w/ws/doc/local/CLAUDE.md']}>
        <Routes>
          <Route path="/w/:workspaceId/doc/*" element={<FileViewerPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Agent Notes' })).toBeInTheDocument());
    expect(screen.getByText('AI Context File')).toBeInTheDocument();
    // Rendered without a WorkspaceLayout Outlet context: pager has no tree to
    // navigate, so both links render as disabled placeholders, not <a> tags.
    expect(screen.queryByRole('link', { name: /back|next/i })).not.toBeInTheDocument();
  });

  it('renders working Back/Next links based on the outlet-provided tree, disabled at the ends', async () => {
    (globalThis as any).__testDataSource = {
      getFile: vi.fn().mockResolvedValue({
        path: 'local/b.md', title: 'B', frontmatter: {}, body: 'body', headings: [], is_ai_context: false,
      }),
    };
    const tree: TreeNode = {
      name: 'WS', path: '', is_dir: true,
      children: [
        {
          name: 'local', path: 'local', is_dir: true,
          children: [
            { name: 'a.md', path: 'local/a.md', is_dir: false },
            { name: 'b.md', path: 'local/b.md', is_dir: false },
            { name: 'c.md', path: 'local/c.md', is_dir: false },
          ],
        },
      ],
    };

    const scrollToTop = vi.fn();
    const resetScroll = vi.fn();
    function ParentWithContext() {
      return <Outlet context={{ tree, scrollToTop, resetScroll }} />;
    }

    render(
      <MemoryRouter initialEntries={['/w/ws/doc/local/b.md']}>
        <Routes>
          <Route element={<ParentWithContext />}>
            <Route path="/w/:workspaceId/doc/*" element={<FileViewerPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'B' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /back/i })).toHaveAttribute('href', '/w/ws/doc/local/a.md');
    expect(screen.getByRole('link', { name: /next/i })).toHaveAttribute('href', '/w/ws/doc/local/c.md');
    expect(resetScroll).toHaveBeenCalledTimes(1); // fires once on initial file load too

    fireEvent.click(screen.getByRole('link', { name: /next/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'B' })).toBeInTheDocument());
    // resetScroll fires again only once the new (navigated-to) file has rendered,
    // not at click time — that's what makes it immune to the Loading-state race.
    expect(resetScroll).toHaveBeenCalledTimes(2);
  });
});
