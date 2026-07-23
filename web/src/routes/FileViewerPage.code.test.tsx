import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { FileViewerPage } from './FileViewerPage';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});
vi.mock('../components/GitHistoryPanel', () => ({ GitHistoryPanel: () => null }));

describe('FileViewerPage kind branching', () => {
  it('renders CodeView for kind:code', async () => {
    (globalThis as any).__testDataSource = {
      getFile: vi.fn().mockResolvedValue({
        path: 'local/main.go',
        title: 'main.go',
        frontmatter: {},
        body: 'package main\nfunc main(){}',
        headings: [],
        is_ai_context: false,
        kind: 'code',
        language: 'go',
      }),
    };
    const { container } = render(
      <MemoryRouter initialEntries={['/w/ws/doc/local/main.go']}>
        <Routes>
          <Route path="/w/:workspaceId/doc/*" element={<FileViewerPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(container.querySelector('.code-view')).toBeInTheDocument());
  });

  it('still renders MarkdownView for kind:markdown', async () => {
    (globalThis as any).__testDataSource = {
      getFile: vi.fn().mockResolvedValue({
        path: 'local/CLAUDE.md',
        title: 'Agent Notes',
        frontmatter: {},
        body: 'hello body',
        headings: [],
        is_ai_context: false,
        kind: 'markdown',
      }),
    };
    const { container } = render(
      <MemoryRouter initialEntries={['/w/ws/doc/local/CLAUDE.md']}>
        <Routes>
          <Route path="/w/:workspaceId/doc/*" element={<FileViewerPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Agent Notes' })).toBeInTheDocument());
    expect(container.querySelector('.code-view')).not.toBeInTheDocument();
  });
});
