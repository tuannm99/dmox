import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AIContextPanel } from './AIContextPanel';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('AIContextPanel', () => {
  it('lists AI context files and copies concatenated content on click', async () => {
    (globalThis as any).__testDataSource = {
      getAIContext: vi.fn().mockResolvedValue([{ source_id: 'local', path: 'CLAUDE.md', title: 'Claude Notes' }]),
      getFile: vi.fn().mockResolvedValue({ path: 'local/CLAUDE.md', title: 'Claude Notes', body: 'agent instructions', frontmatter: {}, headings: [], is_ai_context: true }),
    };
    render(
      <MemoryRouter>
        <AIContextPanel workspaceId="ws" onNavigate={() => {}} />
      </MemoryRouter>
    );
    expect(await screen.findByRole('link', { name: 'Claude Notes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /copy all/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('agent instructions')));
  });

  it('calls onNavigate when a file link is clicked', async () => {
    const onNavigate = vi.fn();
    (globalThis as any).__testDataSource = {
      getAIContext: vi.fn().mockResolvedValue([{ source_id: 'local', path: 'CLAUDE.md', title: 'Claude Notes' }]),
      getFile: vi.fn().mockResolvedValue({ path: 'local/CLAUDE.md', title: 'Claude Notes', body: '', frontmatter: {}, headings: [], is_ai_context: true }),
    };
    render(
      <MemoryRouter>
        <AIContextPanel workspaceId="ws" onNavigate={onNavigate} />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Claude Notes' }));
    expect(onNavigate).toHaveBeenCalled();
  });
});
