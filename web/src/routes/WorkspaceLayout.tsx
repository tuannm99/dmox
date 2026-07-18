import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import { TreeView } from '../components/TreeView';
import type { TreeNode } from '../datasource/types';

export function WorkspaceLayout() {
  const { workspaceId = '' } = useParams();
  const ds = useDataSource();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();
  const docPrefix = `/w/${workspaceId}/doc/`;
  const currentPath = location.pathname.startsWith(docPrefix) ? location.pathname.slice(docPrefix.length) : undefined;

  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setError(null);
    ds.getTree(workspaceId).then(
      (t) => !cancelled && setTree(t),
      (e) => !cancelled && setError(String(e))
    );
    return () => {
      cancelled = true;
    };
  }, [ds, workspaceId]);

  if (error) return <div className="error">Failed to load workspace: {error}</div>;
  if (!tree) return <div className="loading">Loading…</div>;

  return (
    <div className="workspace-shell">
      <nav className="topnav">
        <Link to={`/w/${workspaceId}`}>{tree.name}</Link>
        <Link to={`/w/${workspaceId}/search`}>Search</Link>
        <Link to={`/w/${workspaceId}/ai-context`}>AI Context</Link>
        <Link to={`/w/${workspaceId}/terminal`}>Terminal</Link>
      </nav>
      <div className="workspace-layout">
        <nav className="sidebar">
          <TreeView node={tree} workspaceId={workspaceId} currentPath={currentPath} />
        </nav>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
