import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceLayout } from './WorkspaceLayout';
import { DataSourceProvider } from '../datasource/context';

// jsdom doesn't implement Element.scrollTo — polyfill it so it can be spied on.
if (!HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = () => {};
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
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
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
});
