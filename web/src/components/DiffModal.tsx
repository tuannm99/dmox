import { useEffect, useState } from 'react';
import { diffLines } from 'diff';
import { useDataSource } from '../datasource/context';
import type { FileDiff } from '../datasource/types';

function splitDiffLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function DiffModal({
  workspaceId,
  sourceId,
  path,
  kind = 'live-change',
  onClose,
}: {
  workspaceId: string;
  sourceId: string;
  path: string;
  /** 'live-change' diffs against the previously indexed content (what the
   *  file watcher just replaced); 'working-tree' diffs against the committed
   *  version in git. Same shape, same rendering, different question. */
  kind?: 'live-change' | 'working-tree';
  onClose: () => void;
}) {
  const ds = useDataSource();
  const [diff, setDiff] = useState<FileDiff | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    const request =
      kind === 'working-tree'
        ? ds.getGitWorkingDiff(workspaceId, `${sourceId}/${path}`)
        : ds.getFileDiff(workspaceId, sourceId, path);
    request.then((d) => {
      if (!cancelled) setDiff(d);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, workspaceId, sourceId, path, kind]);

  return (
    <div className="diff-modal-overlay" onClick={onClose}>
      <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-modal-header">
          <span>{path}</span>
          <button type="button" onClick={onClose} aria-label="Close diff">
            ×
          </button>
        </div>
        {diff === null && <div className="loading">Loading…</div>}
        {diff !== null && !diff.available && (
          <p className="diff-unavailable">
            {kind === 'working-tree' ? 'Not inside a git checkout.' : 'No previous version to compare.'}
          </p>
        )}
        {diff !== null && diff.available && diff.old === diff.new && <p className="diff-unavailable">No changes.</p>}
        {diff !== null && diff.available && diff.old !== diff.new && (
          <pre className="diff-body">
            {diffLines(diff.old ?? '', diff.new ?? '').map((part, i) => {
              const cls = part.added ? 'diff-line-added' : part.removed ? 'diff-line-removed' : 'diff-line-context';
              const prefix = part.added ? '+' : part.removed ? '-' : ' ';
              return (
                <div key={i} className={cls}>
                  {splitDiffLines(part.value).map((line, j) => (
                    <div key={j}>
                      {prefix} {line}
                    </div>
                  ))}
                </div>
              );
            })}
          </pre>
        )}
      </div>
    </div>
  );
}
