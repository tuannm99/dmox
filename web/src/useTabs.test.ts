import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTabs } from './useTabs';

beforeEach(() => localStorage.clear());

describe('useTabs', () => {
  it('adds a tab and does not duplicate an already-open path', () => {
    const { result } = renderHook(() => useTabs('ws'));
    act(() => result.current.ensureTab('local/a.md'));
    act(() => result.current.ensureTab('local/a.md'));
    expect(result.current.tabs).toEqual([{ path: 'local/a.md', preview: false }]);
  });

  it('replaces the reusable preview tab in place instead of piling up', () => {
    const { result } = renderHook(() => useTabs('ws'));
    act(() => result.current.ensureTab('local/keep.md'));
    act(() => result.current.ensureTab('local/a.md', { preview: true }));
    act(() => result.current.ensureTab('local/b.md', { preview: true }));
    expect(result.current.tabs).toEqual([
      { path: 'local/keep.md', preview: false },
      { path: 'local/b.md', preview: true },
    ]);
  });

  it('keeps a promoted tab when the next preview file is opened', () => {
    const { result } = renderHook(() => useTabs('ws'));
    act(() => result.current.ensureTab('local/a.md', { preview: true }));
    act(() => result.current.promote('local/a.md'));
    act(() => result.current.ensureTab('local/b.md', { preview: true }));
    expect(result.current.tabs.map((t) => t.path)).toEqual(['local/a.md', 'local/b.md']);
    expect(result.current.tabs[0].preview).toBe(false);
  });

  it('closes one, others, and all', () => {
    const { result } = renderHook(() => useTabs('ws'));
    act(() => result.current.ensureTab('a'));
    act(() => result.current.ensureTab('b'));
    act(() => result.current.ensureTab('c'));
    act(() => result.current.close('b'));
    expect(result.current.tabs.map((t) => t.path)).toEqual(['a', 'c']);
    act(() => result.current.closeOthers('c'));
    expect(result.current.tabs.map((t) => t.path)).toEqual(['c']);
    act(() => result.current.closeAll());
    expect(result.current.tabs).toEqual([]);
  });

  it('persists per workspace and restores on remount', () => {
    const first = renderHook(() => useTabs('ws1'));
    act(() => first.result.current.ensureTab('local/a.md'));
    first.unmount();
    const again = renderHook(() => useTabs('ws1'));
    expect(again.result.current.tabs.map((t) => t.path)).toEqual(['local/a.md']);
  });

  it('keeps workspaces isolated without remounting', () => {
    const { result, rerender } = renderHook(({ ws }) => useTabs(ws), { initialProps: { ws: 'ws1' } });
    act(() => result.current.ensureTab('local/a.md'));
    rerender({ ws: 'ws2' });
    expect(result.current.tabs).toEqual([]);
    act(() => result.current.ensureTab('local/b.md'));
    rerender({ ws: 'ws1' });
    expect(result.current.tabs.map((t) => t.path)).toEqual(['local/a.md']);
  });

  it('survives corrupt stored JSON', () => {
    localStorage.setItem('dmox-tabs-ws', '{not json');
    const { result } = renderHook(() => useTabs('ws'));
    expect(result.current.tabs).toEqual([]);
  });
});
