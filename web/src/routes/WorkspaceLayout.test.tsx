import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceLayout } from './WorkspaceLayout';
import { DataSourceProvider } from '../datasource/context';

beforeEach(() => {
  localStorage.clear();
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

  it('renders nav links to search, ai-context, and terminal', async () => {
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    expect(await screen.findByRole('link', { name: 'Search' })).toHaveAttribute('href', '/w/ws/search');
    expect(screen.getByRole('link', { name: 'AI Context' })).toHaveAttribute('href', '/w/ws/ai-context');
    expect(screen.getByRole('link', { name: 'Terminal' })).toHaveAttribute('href', '/w/ws/terminal');
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
});
