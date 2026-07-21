import { useCallback, useEffect, useState } from 'react';

function storageKey(workspaceId: string): string {
  return `dmox-expanded-${workspaceId}`;
}

function ancestorsOf(path: string): string[] {
  const parts = path.split('/');
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join('/'));
  }
  return ancestors;
}

function readStored(workspaceId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Tracks which tree folders are expanded, per workspace, persisted to
 * localStorage. Everything is collapsed by default (a folder is expanded
 * only once the user has explicitly opened it), matching the tree's
 * default-collapsed-on-load requirement.
 */
export function useExpandedFolders(workspaceId: string) {
  const [expanded, setExpanded] = useState<Set<string>>(() => readStored(workspaceId));

  // WorkspaceLayout stays mounted across workspace switches, so re-read
  // whenever workspaceId changes rather than relying on the initial value.
  useEffect(() => {
    setExpanded(readStored(workspaceId));
  }, [workspaceId]);

  const toggleExpanded = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        localStorage.setItem(storageKey(workspaceId), JSON.stringify([...next]));
        return next;
      });
    },
    [workspaceId]
  );

  const isExpanded = useCallback((path: string) => expanded.has(path), [expanded]);

  // Expands every ancestor directory of `path` (e.g. for "local/sub/a.md",
  // "local" and "local/sub") without collapsing anything already expanded —
  // used to reveal the currently active file in the tree on load.
  const expandAncestors = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const ancestor of ancestorsOf(path)) {
          if (!next.has(ancestor)) {
            next.add(ancestor);
            changed = true;
          }
        }
        if (!changed) return prev;
        localStorage.setItem(storageKey(workspaceId), JSON.stringify([...next]));
        return next;
      });
    },
    [workspaceId]
  );

  return { isExpanded, toggleExpanded, expandAncestors };
}
