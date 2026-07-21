import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExpandedFolders } from './useExpandedFolders';

describe('useExpandedFolders', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with everything collapsed when nothing is stored', () => {
    const { result } = renderHook(() => useExpandedFolders('ws'));
    expect(result.current.isExpanded('local')).toBe(false);
    expect(result.current.isExpanded('local/sub')).toBe(false);
  });

  it('marks a folder expanded after toggling it open', () => {
    const { result } = renderHook(() => useExpandedFolders('ws'));
    act(() => {
      result.current.toggleExpanded('local');
    });
    expect(result.current.isExpanded('local')).toBe(true);
  });

  it('collapses a folder on a second toggle', () => {
    const { result } = renderHook(() => useExpandedFolders('ws'));
    act(() => {
      result.current.toggleExpanded('local');
    });
    act(() => {
      result.current.toggleExpanded('local');
    });
    expect(result.current.isExpanded('local')).toBe(false);
  });

  it('persists expanded folders across remounts, scoped per workspace', () => {
    const { result, unmount } = renderHook(() => useExpandedFolders('ws1'));
    act(() => {
      result.current.toggleExpanded('local');
      result.current.toggleExpanded('local/sub');
    });
    unmount();

    const remounted = renderHook(() => useExpandedFolders('ws1'));
    expect(remounted.result.current.isExpanded('local')).toBe(true);
    expect(remounted.result.current.isExpanded('local/sub')).toBe(true);

    const otherWorkspace = renderHook(() => useExpandedFolders('ws2'));
    expect(otherWorkspace.result.current.isExpanded('local')).toBe(false);
  });

  it('expandAncestors expands every ancestor directory of a file path without collapsing others', () => {
    const { result } = renderHook(() => useExpandedFolders('ws'));
    act(() => {
      result.current.toggleExpanded('other');
    });
    act(() => {
      result.current.expandAncestors('local/sub/nested.md');
    });
    expect(result.current.isExpanded('local')).toBe(true);
    expect(result.current.isExpanded('local/sub')).toBe(true);
    expect(result.current.isExpanded('local/sub/nested.md')).toBe(false); // the file itself, not a directory
    expect(result.current.isExpanded('other')).toBe(true); // untouched
  });

  it('expandAncestors persists across remounts', () => {
    const { result, unmount } = renderHook(() => useExpandedFolders('ws'));
    act(() => {
      result.current.expandAncestors('local/sub/nested.md');
    });
    unmount();

    const remounted = renderHook(() => useExpandedFolders('ws'));
    expect(remounted.result.current.isExpanded('local')).toBe(true);
    expect(remounted.result.current.isExpanded('local/sub')).toBe(true);
  });

  it('re-reads storage when workspaceId changes on an already-mounted instance', () => {
    localStorage.setItem('dmox-expanded-ws1', JSON.stringify(['local']));
    const { result, rerender } = renderHook(({ workspaceId }) => useExpandedFolders(workspaceId), {
      initialProps: { workspaceId: 'ws1' },
    });
    expect(result.current.isExpanded('local')).toBe(true);

    rerender({ workspaceId: 'ws2' });
    expect(result.current.isExpanded('local')).toBe(false);
  });
});
