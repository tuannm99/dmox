import { useCallback, useEffect, useState } from 'react';

export interface FavoriteEntry {
  path: string;
  isDir: boolean;
  name: string;
}

function storageKey(workspaceId: string): string {
  return `dmox-favorites-${workspaceId}`;
}

function readStored(workspaceId: string): FavoriteEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useFavorites(workspaceId: string) {
  const [favorites, setFavorites] = useState<FavoriteEntry[]>(() => readStored(workspaceId));

  // WorkspaceLayout stays mounted across workspace switches (only its props
  // change), so the initial useState value alone won't pick up a different
  // workspace's stored favorites — re-read whenever workspaceId changes.
  useEffect(() => {
    setFavorites(readStored(workspaceId));
  }, [workspaceId]);

  const toggleFavorite = useCallback(
    (entry: FavoriteEntry) => {
      setFavorites((prev) => {
        const next = prev.some((f) => f.path === entry.path)
          ? prev.filter((f) => f.path !== entry.path)
          : [...prev, entry];
        localStorage.setItem(storageKey(workspaceId), JSON.stringify(next));
        return next;
      });
    },
    [workspaceId]
  );

  const isFavorite = useCallback((path: string) => favorites.some((f) => f.path === path), [favorites]);

  return { favorites, toggleFavorite, isFavorite };
}
