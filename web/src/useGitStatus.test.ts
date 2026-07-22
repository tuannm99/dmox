import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useGitStatus, statusLetter } from './useGitStatus';

vi.mock('./datasource/context', async () => {
  const actual = await vi.importActual<typeof import('./datasource/context')>('./datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

describe('useGitStatus', () => {
  it('flattens per-source statuses onto the doc tree\'s own path form', async () => {
    (globalThis as any).__testDataSource = {
      getGitStatus: vi.fn().mockResolvedValue({
        sources: {
          local: {
            applicable: true,
            branch: 'master',
            detached: false,
            files: [
              { path: 'sub/b.md', status: 'modified', staged: false },
              { path: 'a.md', status: 'untracked', staged: false },
            ],
          },
          mirror: { applicable: false, branch: '', detached: false, files: [] },
        },
      }),
    };

    const { result } = renderHook(() => useGitStatus('ws', 0));
    await waitFor(() => expect(result.current.applicable).toBe(true));

    expect(result.current.branch).toBe('master');
    expect(result.current.byPath.get('local/a.md')?.status).toBe('untracked');
    expect(result.current.byPath.get('local/sub/b.md')?.status).toBe('modified');
    expect(result.current.entries.map((e) => e.path)).toEqual(['local/a.md', 'local/sub/b.md']);
  });

  it('reports not-applicable when no source is in a checkout', async () => {
    (globalThis as any).__testDataSource = {
      getGitStatus: vi.fn().mockResolvedValue({
        sources: { local: { applicable: false, branch: '', detached: false, files: [] } },
      }),
    };
    const { result } = renderHook(() => useGitStatus('ws', 0));
    await waitFor(() => expect((globalThis as any).__testDataSource.getGitStatus).toHaveBeenCalled());
    expect(result.current.applicable).toBe(false);
    expect(result.current.entries).toEqual([]);
  });

  it('refetches when the change tick advances', async () => {
    const getGitStatus = vi.fn().mockResolvedValue({ sources: {} });
    (globalThis as any).__testDataSource = { getGitStatus };

    const { rerender } = renderHook(({ tick }) => useGitStatus('ws', tick), { initialProps: { tick: 0 } });
    await waitFor(() => expect(getGitStatus).toHaveBeenCalledTimes(1));

    rerender({ tick: 1 });
    await waitFor(() => expect(getGitStatus).toHaveBeenCalledTimes(2));
  });

  it('stays quiet when the request fails — a workspace with no git is normal', async () => {
    (globalThis as any).__testDataSource = { getGitStatus: vi.fn().mockRejectedValue(new Error('boom')) };
    const { result } = renderHook(() => useGitStatus('ws', 0));
    await waitFor(() => expect((globalThis as any).__testDataSource.getGitStatus).toHaveBeenCalled());
    expect(result.current.applicable).toBe(false);
  });

  it('maps each status to a single-letter badge', () => {
    expect(statusLetter('modified')).toBe('M');
    expect(statusLetter('added')).toBe('A');
    expect(statusLetter('deleted')).toBe('D');
    expect(statusLetter('untracked')).toBe('U');
    expect(statusLetter('conflicted')).toBe('!');
    expect(statusLetter('something-new')).toBe('?');
  });
});
