import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceLayout } from './WorkspaceLayout';
import { DataSourceProvider } from '../datasource/context';

// jsdom doesn't implement Element.scrollTo / scrollIntoView — polyfill both so they can be spied on.
if (!HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = () => {};
}
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  binaryType = '';
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
  }
}

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    open() {}
    write() {}
    dispose() {}
    loadAddon() {}
    onData() {
      return { dispose: () => {} };
    }
    attachCustomKeyEventHandler() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));

beforeEach(() => {
  localStorage.clear();
  MockWebSocket.instances = [];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  // Memoize the merged object per underlying test `ds`, keyed by its identity — WorkspaceLayout's
  // effects depend on `ds` (e.g. the tree-fetch and change-subscription effects use `[ds, workspaceId]`),
  // so returning a fresh object literal on every call would break referential stability and cause
  // those effects to tear down and re-run on every render.
  let cachedBase: unknown;
  let cachedMerged: unknown;
  return {
    ...actual,
    useDataSource: () => {
      const base = (globalThis as any).__testDataSource;
      if (base !== cachedBase) {
        cachedBase = base;
        cachedMerged = {
          subscribeToChanges: () => () => {},
          getGitStatus: async () => ({ sources: {} }),
          getGitWorkingDiff: async () => ({ available: false }),
          ...base,
        };
      }
      return cachedMerged;
    },
  };
});

function renderWithDataSource(ds: any, path = '/w/ws') {
  (globalThis as any).__testDataSource = ds;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/w/:workspaceId" element={<WorkspaceLayout />}>
          <Route index element={<div>welcome</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('WorkspaceLayout', () => {
  it('shows a loading state then renders the tree', async () => {
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => expect(ds.getTree).toHaveBeenCalledWith('ws'));
  });

  it('shows an error message when the tree fails to load', async () => {
    const ds = { getTree: vi.fn().mockRejectedValue(new Error('boom')) };
    renderWithDataSource(ds);
    await waitFor(() => expect(screen.getByText(/failed to load workspace/i)).toBeInTheDocument());
  });

  it('renders toggle buttons for search, ai-context, and terminal', async () => {
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    expect(await screen.findByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI Context' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terminal' })).toBeInTheDocument();
  });

  it('resizes the sidebar by dragging the resize handle, and persists the width', async () => {
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    const sidebar = (await screen.findByRole('separator', { name: 'Resize sidebar' })).previousSibling as HTMLElement;
    expect(sidebar.style.width).toBe('260px');

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
    fireEvent.mouseDown(handle, { clientX: 260 });
    fireEvent.mouseMove(window, { clientX: 360 });
    fireEvent.mouseUp(window, { clientX: 360 });

    expect(sidebar.style.width).toBe('360px');
    await waitFor(() => expect(localStorage.getItem('dmox-sidebar-width')).toBe('360'));
  });

  it('clamps the sidebar width to the min/max bounds', async () => {
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    const handle = await screen.findByRole('separator', { name: 'Resize sidebar' });
    const sidebar = handle.previousSibling as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 260 });
    fireEvent.mouseMove(window, { clientX: -1000 });
    fireEvent.mouseUp(window, { clientX: -1000 });

    expect(sidebar.style.width).toBe('160px');
  });

  it('restores a previously persisted sidebar width on mount', async () => {
    localStorage.setItem('dmox-sidebar-width', '420');
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    const handle = await screen.findByRole('separator', { name: 'Resize sidebar' });
    const sidebar = handle.previousSibling as HTMLElement;
    expect(sidebar.style.width).toBe('420px');
  });

  it('scrolls the content pane back to top when navigating to a new route', async () => {
    const scrollToSpy = vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    (globalThis as any).__testDataSource = ds;
    render(
      <MemoryRouter initialEntries={['/w/ws']}>
        <Routes>
          <Route path="/w/:workspaceId" element={<WorkspaceLayout />}>
            <Route index element={<Link to="/w/ws/search">go to search</Link>} />
            <Route path="search" element={<div>search page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    await screen.findByRole('link', { name: 'go to search' });
    scrollToSpy.mockClear(); // ignore the scroll-to-top call from the initial mount

    fireEvent.click(screen.getByRole('link', { name: 'go to search' }));
    await screen.findByText('search page');

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0 });
    scrollToSpy.mockRestore();
  });

  it('shows a scroll-to-top button once scrolled past the threshold, and scrolls smoothly on click', async () => {
    const scrollToSpy = vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    await screen.findByText('welcome');

    expect(screen.queryByRole('button', { name: /top/i })).not.toBeInTheDocument();

    const content = document.querySelector('.content') as HTMLElement;
    Object.defineProperty(content, 'scrollTop', { value: 400, configurable: true });
    fireEvent.scroll(content);

    const topButton = await screen.findByRole('button', { name: /top/i });
    fireEvent.click(topButton);

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    scrollToSpy.mockRestore();
  });

  it('toggles a panel open and closed when its topnav button is clicked', async () => {
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    const searchButton = await screen.findByRole('button', { name: 'Search' });

    fireEvent.click(searchButton);
    expect(await screen.findByPlaceholderText(/search this workspace/i)).toBeInTheDocument();
    expect(searchButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(searchButton);
    expect(searchButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the terminal WebSocket alive when the panel is toggled closed and reopened', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    const terminalButton = await screen.findByRole('button', { name: 'Terminal' });

    fireEvent.click(terminalButton); // open
    expect(MockWebSocket.instances).toHaveLength(1);

    fireEvent.click(terminalButton); // close
    fireEvent.click(terminalButton); // reopen
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('toggles the terminal panel via the default keyboard shortcut', async () => {
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    await screen.findByRole('button', { name: 'Terminal' });

    fireEvent.keyDown(document, { key: '`', ctrlKey: true });
    expect(await screen.findByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(document, { key: '`', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('closes and clears open panels when switching to a different workspace', async () => {
    const ds = {
      getTree: vi.fn((id: string) =>
        Promise.resolve({ name: id === 'ws1' ? 'WS1' : 'WS2', path: '', is_dir: true, children: [] })
      ),
    };
    (globalThis as any).__testDataSource = ds;
    render(
      <MemoryRouter initialEntries={['/w/ws1']}>
        <Routes>
          <Route path="/w/:workspaceId" element={<WorkspaceLayout />}>
            <Route index element={<Link to="/w/ws2">go to ws2</Link>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const terminalButton = await screen.findByRole('button', { name: 'Terminal' });
    fireEvent.click(terminalButton);
    expect(terminalButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(await screen.findByRole('link', { name: 'go to ws2' }));

    await waitFor(() => expect(ds.getTree).toHaveBeenCalledWith('ws2'));
    expect(await screen.findByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('refetches the tree when a change event arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let capturedOnEvent: ((ev: any) => void) | undefined;
    const getTree = vi
      .fn()
      .mockResolvedValueOnce({ name: 'WS', path: '', is_dir: true, children: [] })
      .mockResolvedValueOnce({ name: 'WS', path: '', is_dir: true, children: [{ name: 'new.md', path: 'local/new.md', is_dir: false }] });
    const ds = {
      getTree,
      subscribeToChanges: (_id: string, onEvent: (ev: any) => void) => {
        capturedOnEvent = onEvent;
        return () => {};
      },
    };
    renderWithDataSource(ds);
    await screen.findByText('welcome');

    capturedOnEvent?.({ sourceId: 'local', path: 'new.md', op: 'create' });
    await vi.advanceTimersByTimeAsync(200);

    await waitFor(() => expect(getTree).toHaveBeenCalledTimes(2));
    vi.useRealTimers();
  });

  it('shows a toast for a change event, with a working View diff / dismiss flow', async () => {
    let capturedOnEvent: ((ev: any) => void) | undefined;
    const ds = {
      getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }),
      subscribeToChanges: (_id: string, onEvent: (ev: any) => void) => {
        capturedOnEvent = onEvent;
        return () => {};
      },
      getFileDiff: vi.fn().mockResolvedValue({ available: false }),
    };
    renderWithDataSource(ds);
    await screen.findByText('welcome');

    capturedOnEvent?.({ sourceId: 'local', path: 'guide.md', op: 'modify' });
    expect(await screen.findByText(/guide\.md/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /view diff/i }));
    await waitFor(() => expect(ds.getFileDiff).toHaveBeenCalledWith('ws', 'local', 'guide.md'));
    expect(await screen.findByText(/no previous version/i)).toBeInTheDocument();
  });

  it('calls the unsubscribe function returned by subscribeToChanges on unmount', async () => {
    const unsubscribe = vi.fn();
    const ds = {
      getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }),
      subscribeToChanges: vi.fn(() => unsubscribe),
    };
    const { unmount } = renderWithDataSource(ds);
    await screen.findByText('welcome');
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('directories default to collapsed, hiding the tree files', async () => {
    const ds = {
      getTree: vi.fn().mockResolvedValue({
        name: 'WS',
        path: '',
        is_dir: true,
        children: [{ name: 'local', path: 'local', is_dir: true, children: [{ name: 'guide.md', path: 'local/guide.md', is_dir: false }] }],
      }),
    };
    renderWithDataSource(ds);
    await screen.findByRole('button', { name: 'local' });
    expect(screen.queryByRole('link', { name: 'guide.md' })).not.toBeInTheDocument();
  });

  it('reveals the active file on load by auto-expanding its ancestor folders and scrolling it into view', async () => {
    const scrollIntoViewSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const ds = {
      getTree: vi.fn().mockResolvedValue({
        name: 'WS',
        path: '',
        is_dir: true,
        children: [
          {
            name: 'local',
            path: 'local',
            is_dir: true,
            children: [
              {
                name: 'sub',
                path: 'local/sub',
                is_dir: true,
                children: [{ name: 'nested.md', path: 'local/sub/nested.md', is_dir: false }],
              },
            ],
          },
        ],
      }),
    };
    (globalThis as any).__testDataSource = ds;
    render(
      <MemoryRouter initialEntries={['/w/ws/doc/local/sub/nested.md']}>
        <Routes>
          <Route path="/w/:workspaceId" element={<WorkspaceLayout />}>
            <Route path="doc/*" element={<div>doc page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const link = await screen.findByRole('link', { name: 'nested.md' });
    expect(link).toHaveClass('active');
    await waitFor(() => expect(scrollIntoViewSpy).toHaveBeenCalled());
    scrollIntoViewSpy.mockRestore();
  });

  it('remembers a manually expanded folder across a remount (simulating a page reload)', async () => {
    const tree = { name: 'WS', path: '', is_dir: true, children: [{ name: 'local', path: 'local', is_dir: true, children: [{ name: 'guide.md', path: 'local/guide.md', is_dir: false }] }] };
    const ds = { getTree: vi.fn().mockResolvedValue(tree) };
    const { unmount } = renderWithDataSource(ds);
    await screen.findByRole('button', { name: 'local' });

    fireEvent.click(screen.getByRole('button', { name: 'local' }));
    expect(screen.getByRole('link', { name: 'guide.md' })).toBeVisible();
    unmount();

    renderWithDataSource(ds);
    await screen.findByRole('button', { name: 'local' });
    expect(screen.getByRole('link', { name: 'guide.md' })).toBeVisible();
  });

  it('reopens the right panel it was left on across a remount (simulating a page reload)', async () => {
    const ds = {
      getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }),
      search: vi.fn().mockResolvedValue([]),
    };
    const { unmount } = renderWithDataSource(ds);
    await screen.findByRole('button', { name: /search/i });

    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(await screen.findByRole('button', { name: 'Close panel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search/i })).toHaveAttribute('aria-pressed', 'true');
    unmount();

    renderWithDataSource(ds);
    expect(await screen.findByRole('button', { name: 'Close panel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not reopen the terminal across a remount, so a reload never spawns a shell', async () => {
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    const { unmount } = renderWithDataSource(ds);
    await screen.findByRole('button', { name: /terminal/i });

    fireEvent.click(screen.getByRole('button', { name: /terminal/i }));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    unmount();

    MockWebSocket.instances = [];
    renderWithDataSource(ds);
    await screen.findByRole('button', { name: /terminal/i });
    expect(screen.getByRole('button', { name: /terminal/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Close panel' })).not.toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(0);
  });
});
