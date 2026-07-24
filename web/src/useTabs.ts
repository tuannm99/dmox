import { useCallback, useEffect, useState } from 'react';

export interface Tab {
  /** Tree-form path, source id first: "local/sub/guide.md". */
  path: string;
  /** A reusable "preview" tab (shown italic) — the next preview open replaces it. */
  preview: boolean;
}

const storageKey = (workspaceId: string) => `dmox-tabs-${workspaceId}`;

function readStored(workspaceId: string): Tab[] {
  if (!workspaceId) return [];
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is { path: string; preview?: unknown } => !!t && typeof (t as { path?: unknown }).path === 'string')
      .map((t) => ({ path: t.path, preview: t.preview === true }));
  } catch {
    return [];
  }
}

function initialState(workspaceId: string) {
  return { workspaceId, tabs: readStored(workspaceId) };
}

/**
 * The open tab list, remembered per workspace.
 *
 * Same shape as useActivePanel: the stored value is read during render and the
 * workspaceId is carried inside the state object, because WorkspaceLayout does
 * not remount when you switch workspaces — reading in an effect would persist
 * the previous workspace's tabs under the new workspace's key before
 * correcting itself.
 *
 * There is deliberately no "active tab" here: the active tab is whatever the
 * URL points at, so back/forward cannot fall out of sync with the tab strip.
 */
export function useTabs(workspaceId: string) {
  const [state, setState] = useState(() => initialState(workspaceId));
  const current = state.workspaceId === workspaceId ? state : initialState(workspaceId);

  if (state.workspaceId !== workspaceId) {
    setState(current);
  }

  useEffect(() => {
    if (!current.workspaceId) return;
    try {
      localStorage.setItem(storageKey(current.workspaceId), JSON.stringify(current.tabs));
    } catch {
      /* storage full or unavailable — tabs just won't be remembered */
    }
  }, [current.workspaceId, current.tabs]);

  const ensureTab = useCallback(
    (path: string, opts?: { preview?: boolean }) => {
      if (!path) return;
      const preview = opts?.preview === true;
      setState((s) => {
        if (s.tabs.some((t) => t.path === path)) return s;
        const next: Tab = { path, preview };
        const previewIdx = preview ? s.tabs.findIndex((t) => t.preview) : -1;
        if (previewIdx >= 0) {
          const tabs = s.tabs.slice();
          tabs[previewIdx] = next;
          return { workspaceId, tabs };
        }
        return { workspaceId, tabs: [...s.tabs, next] };
      });
    },
    [workspaceId]
  );

  const promote = useCallback(
    (path: string) => {
      setState((s) =>
        s.tabs.some((t) => t.path === path && t.preview)
          ? { workspaceId, tabs: s.tabs.map((t) => (t.path === path ? { ...t, preview: false } : t)) }
          : s
      );
    },
    [workspaceId]
  );

  const close = useCallback(
    (path: string) => setState((s) => ({ workspaceId, tabs: s.tabs.filter((t) => t.path !== path) })),
    [workspaceId]
  );

  const closeOthers = useCallback(
    (path: string) => setState((s) => ({ workspaceId, tabs: s.tabs.filter((t) => t.path === path) })),
    [workspaceId]
  );

  const closeAll = useCallback(() => setState({ workspaceId, tabs: [] }), [workspaceId]);

  return { tabs: current.tabs, ensureTab, promote, close, closeOthers, closeAll };
}
