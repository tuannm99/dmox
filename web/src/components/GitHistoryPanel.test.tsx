import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

import { GitHistoryPanel } from './GitHistoryPanel';

describe('GitHistoryPanel', () => {
  it('renders "no history" when not applicable', async () => {
    (globalThis as any).__testDataSource = {
      getGitHistory: vi.fn().mockResolvedValue({ applicable: false, commits: [] }),
    };
    render(<GitHistoryPanel workspaceId="ws" path="local/guide.md" />);
    expect(await screen.findByText(/no git history/i)).toBeInTheDocument();
  });

  it('renders commits and loads blame on demand', async () => {
    (globalThis as any).__testDataSource = {
      getGitHistory: vi.fn().mockResolvedValue({
        applicable: true,
        commits: [{ hash: 'abc1234', author: 'Jane', email: 'j@example.com', date: '2026-01-01T00:00:00Z', message: 'initial commit' }],
      }),
      getGitBlame: vi.fn().mockResolvedValue({
        applicable: true,
        lines: [{ line_no: 1, hash: 'abc1234', author: 'Jane', date: '2026-01-01T00:00:00Z', text: 'hello' }],
      }),
    };
    render(<GitHistoryPanel workspaceId="ws" path="local/guide.md" />);
    expect(await screen.findByText(/initial commit/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show blame/i }));
    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument());
  });
});
