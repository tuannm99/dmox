import { useRef, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Link, MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
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

  it('renders the Back/Next pager above the article body', async () => {
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

    function ParentWithContext() {
      return <Outlet context={{ tree, scrollToTop: vi.fn(), resetScroll: vi.fn() }} />;
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
    const nextLink = screen.getByRole('link', { name: /next/i });
    const heading = screen.getByRole('heading', { name: 'B' });
    expect(nextLink.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('refetches and preserves scroll position when a matching modify event arrives via outlet context', async () => {
    (globalThis as any).__testDataSource = {
      getFile: vi
        .fn()
        .mockResolvedValueOnce({ path: 'local/b.md', title: 'B v1', frontmatter: {}, body: 'body v1', headings: [], is_ai_context: false })
        .mockResolvedValueOnce({ path: 'local/b.md', title: 'B v2', frontmatter: {}, body: 'body v2', headings: [], is_ai_context: false }),
    };

    function ParentWithContext() {
      const [fileChangeEvent, setFileChangeEvent] = useState<{ sourceId: string; path: string; op: 'modify' } | null>(null);
      const contentRef = useRef<HTMLElement>(null);
      return (
        <div>
          <button onClick={() => setFileChangeEvent({ sourceId: 'local', path: 'b.md', op: 'modify' })}>simulate modify</button>
          <Outlet context={{ tree: undefined, scrollToTop: vi.fn(), resetScroll: vi.fn(), contentRef, fileChangeEvent }} />
        </div>
      );
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

    await waitFor(() => expect(screen.getByRole('heading', { name: 'B v1' })).toBeInTheDocument());

    fireEvent.click(screen.getByText('simulate modify'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'B v2' })).toBeInTheDocument());
  });

  it('shows an error when the live-refetch triggered by a modify event rejects', async () => {
    (globalThis as any).__testDataSource = {
      getFile: vi
        .fn()
        .mockResolvedValueOnce({ path: 'local/b.md', title: 'B v1', frontmatter: {}, body: 'body v1', headings: [], is_ai_context: false })
        .mockRejectedValueOnce(new Error('boom')),
    };

    function ParentWithContext() {
      const [fileChangeEvent, setFileChangeEvent] = useState<{ sourceId: string; path: string; op: 'modify' } | null>(null);
      const contentRef = useRef<HTMLElement>(null);
      return (
        <div>
          <button onClick={() => setFileChangeEvent({ sourceId: 'local', path: 'b.md', op: 'modify' })}>simulate modify</button>
          <Outlet context={{ tree: undefined, scrollToTop: vi.fn(), resetScroll: vi.fn(), contentRef, fileChangeEvent }} />
        </div>
      );
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

    await waitFor(() => expect(screen.getByRole('heading', { name: 'B v1' })).toBeInTheDocument());

    fireEvent.click(screen.getByText('simulate modify'));

    await waitFor(() => expect(screen.getByText(/failed to load file/i)).toBeInTheDocument());
  });

  it('shows a deleted banner when a matching delete event arrives via outlet context', async () => {
    (globalThis as any).__testDataSource = {
      getFile: vi.fn().mockResolvedValue({ path: 'local/b.md', title: 'B', frontmatter: {}, body: 'body', headings: [], is_ai_context: false }),
    };

    function ParentWithContext() {
      const [fileChangeEvent, setFileChangeEvent] = useState<{ sourceId: string; path: string; op: 'delete' } | null>(null);
      const contentRef = useRef<HTMLElement>(null);
      return (
        <div>
          <button onClick={() => setFileChangeEvent({ sourceId: 'local', path: 'b.md', op: 'delete' })}>simulate delete</button>
          <Outlet context={{ tree: undefined, scrollToTop: vi.fn(), resetScroll: vi.fn(), contentRef, fileChangeEvent }} />
        </div>
      );
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

    fireEvent.click(screen.getByText('simulate delete'));

    await waitFor(() => expect(screen.getByText(/this file was deleted/i)).toBeInTheDocument());
  });

  it('clears the deleted banner and shows new content when a create event follows a delete for the same path', async () => {
    (globalThis as any).__testDataSource = {
      getFile: vi
        .fn()
        .mockResolvedValueOnce({ path: 'local/b.md', title: 'B v1', frontmatter: {}, body: 'body v1', headings: [], is_ai_context: false })
        .mockResolvedValueOnce({ path: 'local/b.md', title: 'B v2', frontmatter: {}, body: 'body v2', headings: [], is_ai_context: false }),
    };

    function ParentWithContext() {
      const [fileChangeEvent, setFileChangeEvent] = useState<{ sourceId: string; path: string; op: 'delete' | 'create' } | null>(null);
      const contentRef = useRef<HTMLElement>(null);
      return (
        <div>
          <button onClick={() => setFileChangeEvent({ sourceId: 'local', path: 'b.md', op: 'delete' })}>simulate delete</button>
          <button onClick={() => setFileChangeEvent({ sourceId: 'local', path: 'b.md', op: 'create' })}>simulate create</button>
          <Outlet context={{ tree: undefined, scrollToTop: vi.fn(), resetScroll: vi.fn(), contentRef, fileChangeEvent }} />
        </div>
      );
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

    await waitFor(() => expect(screen.getByRole('heading', { name: 'B v1' })).toBeInTheDocument());

    fireEvent.click(screen.getByText('simulate delete'));
    await waitFor(() => expect(screen.getByText(/this file was deleted/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText('simulate create'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'B v2' })).toBeInTheDocument());
    expect(screen.queryByText(/this file was deleted/i)).not.toBeInTheDocument();
  });

  describe('scroll memory', () => {
    // jsdom has no layout, so give the content pane a fake scrolling box.
    function ParentWithScrollableContent({ resetScroll }: { resetScroll: () => void }) {
      const contentRef = useRef<HTMLElement>(null);
      const attach = (node: HTMLElement | null) => {
        if (node && contentRef.current !== node) {
          let top = 0;
          Object.defineProperty(node, 'scrollTop', {
            get: () => top,
            set: (v: number) => {
              top = v;
            },
            configurable: true,
          });
          (contentRef as { current: HTMLElement | null }).current = node;
        }
      };
      return (
        <main className="content" ref={attach}>
          <Link to="/w/ws/doc/local/c.md">open c</Link>
          {/* Mirrors how WorkspaceLayout's tab bar navigates (Task 3): a PUSH
              carrying { restoreScroll: true } in router state. */}
          <Link to="/w/ws/doc/local/c.md" state={{ restoreScroll: true }}>
            open c as tab
          </Link>
          <Outlet context={{ tree: undefined, scrollToTop: vi.fn(), resetScroll, contentRef, fileChangeEvent: null }} />
        </main>
      );
    }

    function renderAt(path: string) {
      const resetScroll = vi.fn();
      (globalThis as any).__testDataSource = {
        getFile: vi.fn().mockResolvedValue({ path: 'local/c.md', title: 'C', frontmatter: {}, body: 'body', headings: [], is_ai_context: false }),
      };
      const utils = render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<ParentWithScrollableContent resetScroll={resetScroll} />}>
              <Route path="/w/:workspaceId" element={<div>index</div>} />
              <Route path="/w/:workspaceId/doc/*" element={<FileViewerPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      );
      return { ...utils, resetScroll, content: () => utils.container.querySelector('.content') as HTMLElement };
    }

    it('records the reader position and restores it on a reload', async () => {
      sessionStorage.clear();
      const first = renderAt('/w/ws/doc/local/c.md');
      await screen.findByRole('heading', { name: 'C' });

      first.content().scrollTop = 640;
      fireEvent.scroll(first.content());
      await waitFor(() => expect(sessionStorage.getItem('dmox-scroll-ws:local/c.md')).toBe('640'));
      first.unmount();

      // A MemoryRouter's initial entry is a POP — the same navigation type a
      // browser reload produces.
      const reloaded = renderAt('/w/ws/doc/local/c.md');
      await screen.findByRole('heading', { name: 'C' });
      await waitFor(() => expect(reloaded.content().scrollTop).toBe(640));
      expect(reloaded.resetScroll).not.toHaveBeenCalled();
    });

    it('still starts at the top when the doc is opened fresh rather than reloaded', async () => {
      sessionStorage.clear();
      sessionStorage.setItem('dmox-scroll-ws:local/c.md', '640');
      const view = renderAt('/w/ws');
      await screen.findByText('index');

      // Clicking a link is a PUSH, not a POP: a fresh read starts at the top.
      fireEvent.click(screen.getByRole('link', { name: 'open c' }));
      await screen.findByRole('heading', { name: 'C' });

      expect(view.resetScroll).toHaveBeenCalled();
      expect(view.content().scrollTop).toBe(0);
    });

    it('restores the saved position when a tab click asks for it (PUSH with restoreScroll state)', async () => {
      sessionStorage.clear();
      sessionStorage.setItem('dmox-scroll-ws:local/c.md', '1200');
      const view = renderAt('/w/ws');
      await screen.findByText('index');

      // Clicking a tab is a PUSH, not a POP — but it's flagged, so it must
      // still restore, unlike an ordinary fresh-open PUSH.
      fireEvent.click(screen.getByRole('link', { name: 'open c as tab' }));
      await screen.findByRole('heading', { name: 'C' });

      await waitFor(() => expect(view.content().scrollTop).toBe(1200));
      expect(view.resetScroll).not.toHaveBeenCalled();
    });

    it('still starts at the top when a file is opened fresh from the tree (PUSH with no state)', async () => {
      sessionStorage.clear();
      sessionStorage.setItem('dmox-scroll-ws:local/c.md', '1200');
      const view = renderAt('/w/ws');
      await screen.findByText('index');

      fireEvent.click(screen.getByRole('link', { name: 'open c' }));
      await screen.findByRole('heading', { name: 'C' });

      expect(view.resetScroll).toHaveBeenCalled();
      expect(view.content().scrollTop).toBe(0);
    });

    it('restores the saved position on the SECOND return to a tab, not just the first (A -> B -> A -> B -> A)', async () => {
      // Regression test for the bug where restoredForRef, once set for a path,
      // was never cleared — so a later return visit to that same path (after
      // bouncing through another tab with no saved offset) had the restore
      // guard skip the restore and fall through to resetScroll, snapping the
      // reader back to the top.
      sessionStorage.clear();
      (globalThis as any).__testDataSource = {
        getFile: vi.fn((_ws: string, path: string) =>
          Promise.resolve({ path, title: path, frontmatter: {}, body: 'body', headings: [], is_ai_context: false })
        ),
      };

      function ParentWithTwoTabs() {
        const contentRef = useRef<HTMLElement>(null);
        const attach = (node: HTMLElement | null) => {
          if (node && contentRef.current !== node) {
            let top = 0;
            Object.defineProperty(node, 'scrollTop', {
              get: () => top,
              set: (v: number) => {
                top = v;
              },
              configurable: true,
            });
            (contentRef as { current: HTMLElement | null }).current = node;
          }
        };
        // resetScroll mirrors WorkspaceLayout's real implementation (sets
        // scrollTop back to 0) rather than being a no-op spy, so the test can
        // actually distinguish "restored to 900" from "never moved".
        const resetScroll = () => {
          if (contentRef.current) contentRef.current.scrollTop = 0;
        };
        return (
          <main className="content" ref={attach}>
            <Link to="/w/ws/doc/local/a.md" state={{ restoreScroll: true }}>
              go a
            </Link>
            <Link to="/w/ws/doc/local/b.md" state={{ restoreScroll: true }}>
              go b
            </Link>
            <Outlet context={{ tree: undefined, scrollToTop: vi.fn(), resetScroll, contentRef, fileChangeEvent: null }} />
          </main>
        );
      }

      const utils = render(
        <MemoryRouter initialEntries={['/w/ws/doc/local/a.md']}>
          <Routes>
            <Route element={<ParentWithTwoTabs />}>
              <Route path="/w/:workspaceId/doc/*" element={<FileViewerPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      );
      const content = () => utils.container.querySelector('.content') as HTMLElement;

      // 1. Read A, scroll to 900.
      await screen.findByRole('heading', { name: 'local/a.md' });
      content().scrollTop = 900;
      fireEvent.scroll(content());
      await waitFor(() => expect(sessionStorage.getItem('dmox-scroll-ws:local/a.md')).toBe('900'));

      // 2. Switch to B — never scrolled, no saved offset.
      fireEvent.click(screen.getByRole('link', { name: 'go b' }));
      await screen.findByRole('heading', { name: 'local/b.md' });

      // 3. Back to A — first return restores 900.
      fireEvent.click(screen.getByRole('link', { name: 'go a' }));
      await screen.findByRole('heading', { name: 'local/a.md' });
      await waitFor(() => expect(content().scrollTop).toBe(900));

      // 4. Switch to B again — still no saved offset for B.
      fireEvent.click(screen.getByRole('link', { name: 'go b' }));
      await screen.findByRole('heading', { name: 'local/b.md' });

      // 5. Back to A a SECOND time — must still restore 900, not reset to 0.
      fireEvent.click(screen.getByRole('link', { name: 'go a' }));
      await screen.findByRole('heading', { name: 'local/a.md' });
      await waitFor(() => expect(content().scrollTop).toBe(900));
    });
  });
});
