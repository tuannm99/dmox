import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SearchPanel } from './SearchPanel';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

function setup(searchImpl: any, onNavigate = vi.fn()) {
  (globalThis as any).__testDataSource = { search: searchImpl };
  return { onNavigate, ...render(
    <MemoryRouter>
      <SearchPanel workspaceId="ws" onNavigate={onNavigate} />
    </MemoryRouter>
  ) };
}

describe('SearchPanel', () => {
  it('debounces input and renders results with links', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const search = vi.fn().mockResolvedValue([
      { workspace_id: 'ws', source_id: 'local', path: 'guide.md', title: 'Getting Started', snippet: '<mark>getting</mark> started', score: 1 },
    ]);
    setup(search);
    fireEvent.change(screen.getByPlaceholderText(/search this workspace/i), { target: { value: 'getting' } });
    vi.advanceTimersByTime(250);
    await waitFor(() => expect(search).toHaveBeenCalledWith('ws', 'getting'));
    expect(await screen.findByRole('link', { name: 'Getting Started' })).toHaveAttribute(
      'href',
      '/w/ws/doc/local/guide.md'
    );
    vi.useRealTimers();
  });

  it('does not call search for an empty query', () => {
    const search = vi.fn();
    setup(search);
    fireEvent.change(screen.getByPlaceholderText(/search this workspace/i), { target: { value: '' } });
    expect(search).not.toHaveBeenCalled();
  });

  it('calls onNavigate when a result link is clicked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const search = vi.fn().mockResolvedValue([
      { workspace_id: 'ws', source_id: 'local', path: 'guide.md', title: 'Getting Started', snippet: 'x', score: 1 },
    ]);
    const { onNavigate } = setup(search);
    fireEvent.change(screen.getByPlaceholderText(/search this workspace/i), { target: { value: 'getting' } });
    vi.advanceTimersByTime(250);
    const link = await screen.findByRole('link', { name: 'Getting Started' });
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
