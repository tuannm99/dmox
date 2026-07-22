import { useEffect, useMemo, useState } from 'react';
import { useDataSource } from './datasource/context';
import type { GitFileEntry, GitStatus } from './datasource/types';

export interface GitStatusView {
  /** True when at least one source sits inside a real git checkout. */
  applicable: boolean;
  /** Branch of the first applicable source; workspaces normally have one. */
  branch: string;
  detached: boolean;
  /** Keyed by the doc tree's own `sourceId/relative/path` form. */
  byPath: Map<string, GitFileEntry>;
  /** Same entries, with tree-style paths, ordered for display. */
  entries: { path: string; entry: GitFileEntry }[];
}

const EMPTY: GitStatusView = { applicable: false, branch: '', detached: false, byPath: new Map(), entries: [] };

/**
 * Working-tree status for every source in a workspace.
 *
 * `changeTick` is bumped by WorkspaceLayout whenever the file watcher reports
 * anything, which is what keeps this current: the backend caches the status
 * (go-git's scan is slow) and drops that cache on the same events, so
 * refetching here is cheap and returns fresh data.
 */
export function useGitStatus(workspaceId: string, changeTick: number): GitStatusView {
  const ds = useDataSource();
  const [status, setStatus] = useState<GitStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    ds.getGitStatus(workspaceId).then(
      (s) => !cancelled && setStatus(s),
      // A workspace with no git anywhere is normal, not worth surfacing.
      () => !cancelled && setStatus(null)
    );
    return () => {
      cancelled = true;
    };
  }, [ds, workspaceId, changeTick]);

  return useMemo(() => {
    if (!status) return EMPTY;
    const byPath = new Map<string, GitFileEntry>();
    const entries: { path: string; entry: GitFileEntry }[] = [];
    let branch = '';
    let detached = false;
    let applicable = false;

    for (const [sourceId, src] of Object.entries(status.sources)) {
      if (!src.applicable) continue;
      applicable = true;
      if (!branch) {
        branch = src.branch;
        detached = src.detached;
      }
      for (const entry of src.files) {
        const path = `${sourceId}/${entry.path}`;
        byPath.set(path, entry);
        entries.push({ path, entry });
      }
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return { applicable, branch, detached, byPath, entries };
  }, [status]);
}

const LETTERS: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: 'U',
  renamed: 'R',
  copied: 'C',
  conflicted: '!',
};

export function statusLetter(status: string): string {
  return LETTERS[status] ?? '?';
}
