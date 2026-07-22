import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActivePanel } from './useActivePanel';

describe('useActivePanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with no panel open when nothing is stored', () => {
    const { result } = renderHook(() => useActivePanel('ws'));
    expect(result.current.activePanel).toBeNull();
    expect(result.current.openedPanels.size).toBe(0);
  });

  it('remembers the open panel across a remount', () => {
    const first = renderHook(() => useActivePanel('ws'));
    act(() => first.result.current.togglePanel('search'));
    expect(first.result.current.activePanel).toBe('search');
    first.unmount();

    const second = renderHook(() => useActivePanel('ws'));
    expect(second.result.current.activePanel).toBe('search');
    // Restored panels must count as already-opened, or WorkspaceLayout's
    // lazy mounting never renders the pane.
    expect(second.result.current.openedPanels.has('search')).toBe(true);
  });

  it('forgets the panel once it is toggled closed', () => {
    const { result, unmount } = renderHook(() => useActivePanel('ws'));
    act(() => result.current.togglePanel('search'));
    act(() => result.current.togglePanel('search'));
    expect(result.current.activePanel).toBeNull();
    unmount();

    const again = renderHook(() => useActivePanel('ws'));
    expect(again.result.current.activePanel).toBeNull();
  });

  it('never restores the terminal, so a reload does not spawn a shell', () => {
    const { result, unmount } = renderHook(() => useActivePanel('ws'));
    act(() => result.current.togglePanel('search'));
    act(() => result.current.togglePanel('terminal'));
    expect(result.current.activePanel).toBe('terminal');
    // Switching to the terminal also clears the stored search panel — the
    // user moved off it, so it must not reappear on the next load either.
    expect(localStorage.getItem('dmox-panel-ws')).toBeNull();
    unmount();

    const again = renderHook(() => useActivePanel('ws'));
    expect(again.result.current.activePanel).toBeNull();
    expect(again.result.current.openedPanels.has('terminal')).toBe(false);
  });

  it('keeps the selection separate per workspace without remounting', () => {
    const { result, rerender } = renderHook(({ ws }) => useActivePanel(ws), { initialProps: { ws: 'a' } });
    act(() => result.current.togglePanel('search'));

    rerender({ ws: 'b' });
    expect(result.current.activePanel).toBeNull();

    act(() => result.current.togglePanel('ai-context'));
    expect(result.current.activePanel).toBe('ai-context');

    rerender({ ws: 'a' });
    expect(result.current.activePanel).toBe('search');
    expect(localStorage.getItem('dmox-panel-b')).toBe('ai-context');
  });

  it('ignores a stored value that is not a restorable panel', () => {
    localStorage.setItem('dmox-panel-ws', 'terminal');
    const { result } = renderHook(() => useActivePanel('ws'));
    expect(result.current.activePanel).toBeNull();
  });
});
