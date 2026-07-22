import { useCallback, useEffect, useState } from 'react';
import type { PanelKind } from './keymap';

const storageKey = (workspaceId: string) => `dmox-panel-${workspaceId}`;

// The Terminal is deliberately excluded: opening that panel spawns a real PTY
// shell (internal/terminal), so restoring it would start a new shell process
// on every page load — including reloads the user never thought of as
// "opening a terminal". Search and AI Context are pure reads, safe to bring
// back exactly as they were left.
const RESTORABLE: readonly PanelKind[] = ['search', 'ai-context'];

function readStored(workspaceId: string): PanelKind | null {
  if (!workspaceId) return null;
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    return RESTORABLE.includes(raw as PanelKind) ? (raw as PanelKind) : null;
  } catch {
    return null;
  }
}

function initialState(workspaceId: string) {
  const active = readStored(workspaceId);
  // Panels are lazy-mounted on first open and then kept mounted (see
  // WorkspaceLayout), so a restored panel has to count as already-opened or
  // its pane never renders at all.
  return { workspaceId, active, opened: active ? new Set<PanelKind>([active]) : new Set<PanelKind>() };
}

/**
 * Right-panel selection, remembered per workspace.
 *
 * WorkspaceLayout does not remount when you switch workspaces, so the stored
 * value is re-read during render rather than from an effect: an effect would
 * run after a commit that still holds the previous workspace's panel, and the
 * persist step below would write that stale value under the new workspace's
 * key before being corrected. Carrying workspaceId inside the state object
 * keeps the two in lockstep instead.
 */
export function useActivePanel(workspaceId: string) {
  const [state, setState] = useState(() => initialState(workspaceId));
  const current = state.workspaceId === workspaceId ? state : initialState(workspaceId);

  if (state.workspaceId !== workspaceId) {
    setState(current);
  }

  useEffect(() => {
    if (!current.workspaceId) return;
    try {
      // Selecting a non-restorable panel still clears the key: the user moved
      // off whatever was stored, so it must not come back on the next load.
      if (current.active && RESTORABLE.includes(current.active)) localStorage.setItem(storageKey(current.workspaceId), current.active);
      else localStorage.removeItem(storageKey(current.workspaceId));
    } catch {
      /* storage full or unavailable — the panel just won't be remembered */
    }
  }, [current.workspaceId, current.active]);

  const setActivePanel = useCallback(
    (panel: PanelKind | null) => {
      setState((s) => ({
        workspaceId,
        active: panel,
        opened: panel && !s.opened.has(panel) ? new Set(s.opened).add(panel) : s.opened,
      }));
    },
    [workspaceId]
  );

  const togglePanel = useCallback(
    (kind: PanelKind) => {
      setState((s) => ({
        workspaceId,
        active: s.active === kind ? null : kind,
        opened: s.opened.has(kind) ? s.opened : new Set(s.opened).add(kind),
      }));
    },
    [workspaceId]
  );

  return { activePanel: current.active, openedPanels: current.opened, setActivePanel, togglePanel };
}
