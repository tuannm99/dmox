import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFavorites } from './useFavorites';

describe('useFavorites', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useFavorites('ws'));
    expect(result.current.favorites).toEqual([]);
  });

  it('adds a favorite on toggle', () => {
    const { result } = renderHook(() => useFavorites('ws'));
    act(() => {
      result.current.toggleFavorite({ path: 'local/guide.md', isDir: false, name: 'guide.md' });
    });
    expect(result.current.favorites).toEqual([{ path: 'local/guide.md', isDir: false, name: 'guide.md' }]);
    expect(result.current.isFavorite('local/guide.md')).toBe(true);
  });

  it('removes a favorite on a second toggle (no duplicates)', () => {
    const { result } = renderHook(() => useFavorites('ws'));
    const entry = { path: 'local/guide.md', isDir: false, name: 'guide.md' };
    act(() => {
      result.current.toggleFavorite(entry);
    });
    act(() => {
      result.current.toggleFavorite(entry);
    });
    expect(result.current.favorites).toEqual([]);
    expect(result.current.isFavorite('local/guide.md')).toBe(false);
  });

  it('toggling the same path twice never produces a duplicate entry', () => {
    const { result } = renderHook(() => useFavorites('ws'));
    const entry = { path: 'local/guide.md', isDir: false, name: 'guide.md' };
    act(() => {
      result.current.toggleFavorite(entry);
      result.current.toggleFavorite({ ...entry, name: 'renamed-in-memory.md' });
    });
    // second toggle for the same path removes it, regardless of other field changes
    expect(result.current.favorites).toEqual([]);
  });

  it('persists favorites across remounts, scoped per workspace', () => {
    const { result, unmount } = renderHook(() => useFavorites('ws1'));
    act(() => {
      result.current.toggleFavorite({ path: 'local/a.md', isDir: false, name: 'a.md' });
    });
    unmount();

    const remounted = renderHook(() => useFavorites('ws1'));
    expect(remounted.result.current.favorites).toEqual([{ path: 'local/a.md', isDir: false, name: 'a.md' }]);

    const otherWorkspace = renderHook(() => useFavorites('ws2'));
    expect(otherWorkspace.result.current.favorites).toEqual([]);
  });

  it('re-reads storage when workspaceId changes on an already-mounted instance', () => {
    localStorage.setItem(
      'dmox-favorites-ws1',
      JSON.stringify([{ path: 'local/a.md', isDir: false, name: 'a.md' }])
    );
    const { result, rerender } = renderHook(({ workspaceId }) => useFavorites(workspaceId), {
      initialProps: { workspaceId: 'ws1' },
    });
    expect(result.current.favorites).toEqual([{ path: 'local/a.md', isDir: false, name: 'a.md' }]);

    rerender({ workspaceId: 'ws2' });
    expect(result.current.favorites).toEqual([]);
  });

  it('supports favoriting a directory', () => {
    const { result } = renderHook(() => useFavorites('ws'));
    act(() => {
      result.current.toggleFavorite({ path: 'local/sub', isDir: true, name: 'sub' });
    });
    expect(result.current.favorites).toEqual([{ path: 'local/sub', isDir: true, name: 'sub' }]);
  });
});
