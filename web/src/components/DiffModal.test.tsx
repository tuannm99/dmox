import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DiffModal } from './DiffModal';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

describe('DiffModal', () => {
  it('renders removed and added lines from the fetched diff', async () => {
    (globalThis as any).__testDataSource = {
      getFileDiff: vi.fn().mockResolvedValue({ available: true, old: 'line1\nline2', new: 'line1\nline2 changed' }),
    };
    render(<DiffModal workspaceId="ws" sourceId="local" path="guide.md" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/- line2/)).toBeInTheDocument());
    expect(screen.getByText(/\+ line2 changed/)).toBeInTheDocument();
  });

  it('shows a message when no previous version is available', async () => {
    (globalThis as any).__testDataSource = {
      getFileDiff: vi.fn().mockResolvedValue({ available: false }),
    };
    render(<DiffModal workspaceId="ws" sourceId="local" path="guide.md" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no previous version/i)).toBeInTheDocument());
  });

  it('shows a "no changes" message when the diff is available but old equals new', async () => {
    (globalThis as any).__testDataSource = {
      getFileDiff: vi.fn().mockResolvedValue({ available: true, old: 'same\ncontent', new: 'same\ncontent' }),
    };
    render(<DiffModal workspaceId="ws" sourceId="local" path="guide.md" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no changes/i)).toBeInTheDocument());
  });

  it('calls onClose when the close button is clicked', async () => {
    (globalThis as any).__testDataSource = {
      getFileDiff: vi.fn().mockResolvedValue({ available: false }),
    };
    const onClose = vi.fn();
    render(<DiffModal workspaceId="ws" sourceId="local" path="guide.md" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText(/no previous version/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /close diff/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
