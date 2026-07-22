import { Link } from 'react-router-dom';
import { statusLetter, type GitStatusView } from '../useGitStatus';

/**
 * Uncommitted changes in the workspace's sources, listed the way an editor's
 * source-control pane does. Renders nothing at all when no source is inside a
 * git checkout — which is the normal case for a docs/ directory mounted on its
 * own, without the surrounding repository.
 */
export function GitChangesSection({
  workspaceId,
  status,
  onViewDiff,
}: {
  workspaceId: string;
  status: GitStatusView;
  onViewDiff: (sourceId: string, path: string) => void;
}) {
  if (!status.applicable) return null;

  return (
    <div className="git-changes-section">
      <div className="git-changes-header">
        <span className="git-branch" title={status.detached ? 'Detached HEAD' : 'Current branch'}>
          {status.detached ? '➤' : '⎇'} {status.branch || '(no commits)'}
        </span>
        {status.entries.length > 0 && <span className="git-changes-count">{status.entries.length}</span>}
      </div>
      {status.entries.length === 0 ? (
        <p className="git-changes-empty">No changes</p>
      ) : (
        <ul className="git-changes-list">
          {status.entries.map(({ path, entry }) => {
            const slash = path.indexOf('/');
            const sourceId = path.slice(0, slash);
            const rel = path.slice(slash + 1);
            const name = rel.slice(rel.lastIndexOf('/') + 1);
            const title = `${path} — ${entry.status}${entry.staged ? ' (staged)' : ''}`;
            const label = (
              <>
                <span className={`git-status-badge git-status-${entry.status}`} aria-hidden="true">
                  {statusLetter(entry.status)}
                </span>
                <span className="git-change-name">{name}</span>
                <span className="git-change-dir">{rel.slice(0, rel.lastIndexOf('/'))}</span>
              </>
            );
            return (
              <li key={path} className="git-change-row">
                {/* A deleted file has nothing left to open — the diff button
                    beside it is the only thing that can still show it. */}
                {entry.status === 'deleted' ? (
                  <span className="git-change-link git-change-gone" title={title}>
                    {label}
                  </span>
                ) : (
                  <Link to={`/w/${workspaceId}/doc/${path}`} className="git-change-link" title={title}>
                    {label}
                  </Link>
                )}
                <button
                  type="button"
                  className="git-change-diff"
                  aria-label={`View changes in ${name}`}
                  onClick={() => onViewDiff(sourceId, rel)}
                >
                  ±
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
