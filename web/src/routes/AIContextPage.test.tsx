import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AIContextPage } from './AIContextPage';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

describe('AIContextPage', () => {
  it('lists AI context files and copies concatenated content on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    (globalThis as any).__testDataSource = {
      getAIContext: vi.fn().mockResolvedValue([{ source_id: 'local', path: 'CLAUDE.md', title: 'Claude Notes' }]),
      getFile: vi.fn().mockResolvedValue({ path: 'local/CLAUDE.md', title: 'Claude Notes', body: 'agent instructions', frontmatter: {}, headings: [], is_ai_context: true }),
    };
    render(
      <MemoryRouter initialEntries={['/w/ws/ai-context']}>
        <Routes>
          <Route path="/w/:workspaceId/ai-context" element={<AIContextPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole('link', { name: 'Claude Notes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /copy all/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('agent instructions')));
  });
});
