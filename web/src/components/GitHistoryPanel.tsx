import { useEffect, useState } from 'react';
import { useDataSource } from '../datasource/context';
import type { BlameLine, Commit } from '../datasource/types';

export function GitHistoryPanel({ workspaceId, path }: { workspaceId: string; path: string }) {
  const ds = useDataSource();
  const [state, setState] = useState<{ applicable: boolean; commits: Commit[] } | null>(null);
  const [blame, setBlame] = useState<BlameLine[] | null>(null);

  useEffect(() => {
    setState(null);
    setBlame(null);
    ds.getGitHistory(workspaceId, path).then(setState, () => setState({ applicable: false, commits: [] }));
  }, [ds, workspaceId, path]);

  async function loadBlame() {
    const result = await ds.getGitBlame(workspaceId, path);
    setBlame(result.applicable ? result.lines : []);
  }

  if (!state) return null;
  if (!state.applicable) return <p className="git-history-na">No Git history for this file.</p>;

  return (
    <div className="git-history-panel">
      <ul className="git-history">
        {state.commits.map((c) => (
          <li key={c.hash}>
            <code>{c.hash.slice(0, 7)}</code> {c.message} — {c.author}, {new Date(c.date).toLocaleDateString()}
          </li>
        ))}
      </ul>
      {blame === null ? (
        <button type="button" onClick={loadBlame}>
          Show blame
        </button>
      ) : (
        <table className="blame-table">
          <tbody>
            {blame.map((l) => (
              <tr key={l.line_no}>
                <td className="blame-meta">
                  {l.hash.slice(0, 7)} {l.author}
                </td>
                <td className="blame-line">{l.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
