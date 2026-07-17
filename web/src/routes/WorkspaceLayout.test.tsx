import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceLayout } from './WorkspaceLayout';
import { DataSourceProvider } from '../datasource/context';

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
});
