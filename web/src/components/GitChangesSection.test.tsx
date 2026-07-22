import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GitChangesSection } from './GitChangesSection';
import type { GitStatusView } from '../useGitStatus';
import type { GitFileEntry } from '../datasource/types';

function view(partial: Partial<GitStatusView> = {}): GitStatusView {
  const entries = partial.entries ?? [];
  return {
    applicable: true,
    branch: 'master',
    detached: false,
    byPath: new Map(entries.map((e) => [e.path, e.entry])),
    entries,
    ...partial,
  };
}

const entry = (path: string, status: GitFileEntry['status'], staged = false) => ({
  path,
  entry: { path: path.slice(path.indexOf('/') + 1), status, staged },
});

function renderSection(status: GitStatusView, onViewDiff = vi.fn()) {
  render(
    <MemoryRouter>
      <GitChangesSection workspaceId="ws" status={status} onViewDiff={onViewDiff} />
    </MemoryRouter>
  );
  return { onViewDiff };
}

describe('GitChangesSection', () => {
  it('renders nothing when no source is inside a git checkout', () => {
    const { container } = render(
      <MemoryRouter>
        <GitChangesSection workspaceId="ws" status={view({ applicable: false })} onViewDiff={vi.fn()} />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the branch and says so when the tree is clean', () => {
    renderSection(view());
    expect(screen.getByText(/master/)).toBeInTheDocument();
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });

  it('marks a detached HEAD differently from a branch', () => {
    renderSection(view({ branch: 'a1b2c3d', detached: true }));
    expect(screen.getByTitle('Detached HEAD')).toBeInTheDocument();
  });

  it('lists each changed file with its status letter and a link to the doc', () => {
    renderSection(
      view({
        entries: [entry('local/guide.md', 'modified'), entry('local/sub/new.md', 'untracked')],
      })
    );

    const guide = screen.getByRole('link', { name: /guide\.md/ });
    expect(guide).toHaveAttribute('href', '/w/ws/doc/local/guide.md');
    expect(guide).toHaveTextContent('M');

    const fresh = screen.getByRole('link', { name: /new\.md/ });
    expect(fresh).toHaveAttribute('href', '/w/ws/doc/local/sub/new.md');
    expect(fresh).toHaveTextContent('U');
    // The count badge tells you how many without reading the list.
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('opens the diff for a file, passing the source and its source-relative path', () => {
    const { onViewDiff } = renderSection(view({ entries: [entry('local/sub/guide.md', 'modified')] }));
    fireEvent.click(screen.getByRole('button', { name: 'View changes in guide.md' }));
    expect(onViewDiff).toHaveBeenCalledWith('local', 'sub/guide.md');
  });

  it('does not link a deleted file, since there is nothing left to open', () => {
    renderSection(view({ entries: [entry('local/gone.md', 'deleted')] }));
    expect(screen.queryByRole('link', { name: /gone\.md/ })).not.toBeInTheDocument();
    expect(screen.getByText('gone.md')).toBeInTheDocument();
    // The diff is still reachable — that is the only way to see what it held.
    expect(screen.getByRole('button', { name: 'View changes in gone.md' })).toBeInTheDocument();
  });
});
