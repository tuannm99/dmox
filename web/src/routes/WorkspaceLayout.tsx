import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import { TreeView } from '../components/TreeView';
import type { TreeNode } from '../datasource/types';

export interface WorkspaceOutletContext {
  tree: TreeNode;
}

const SIDEBAR_WIDTH_KEY = 'dmox-sidebar-width';
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 260;

function readStoredSidebarWidth(): number {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return stored >= MIN_SIDEBAR_WIDTH && stored <= MAX_SIDEBAR_WIDTH ? stored : DEFAULT_SIDEBAR_WIDTH;
}

export function WorkspaceLayout() {
  const { workspaceId = '' } = useParams();
  const ds = useDataSource();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
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

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragStartRef.current = { startX: e.clientX, startWidth: sidebarWidth };
      setDragging(true);
    },
    [sidebarWidth]
  );

  useEffect(() => {
    if (!dragging) return;

    function onMove(e: MouseEvent) {
      if (!dragStartRef.current) return;
      const next = dragStartRef.current.startWidth + (e.clientX - dragStartRef.current.startX);
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, next)));
    }
    function onUp() {
      dragStartRef.current = null;
      setDragging(false);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  if (error) return <div className="error">Failed to load workspace: {error}</div>;
  if (!tree) return <div className="loading">Loading…</div>;

  return (
    <div className={dragging ? 'workspace-shell resizing' : 'workspace-shell'}>
      <nav className="topnav">
        <Link to={`/w/${workspaceId}`}>{tree.name}</Link>
        <Link to={`/w/${workspaceId}/search`}>Search</Link>
        <Link to={`/w/${workspaceId}/ai-context`}>AI Context</Link>
        <Link to={`/w/${workspaceId}/terminal`}>Terminal</Link>
      </nav>
      <div className="workspace-layout">
        <nav className="sidebar" style={{ width: sidebarWidth }}>
          <TreeView node={tree} workspaceId={workspaceId} currentPath={currentPath} />
        </nav>
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={handleResizeMouseDown}
        />
        <main className="content">
          <Outlet context={{ tree } satisfies WorkspaceOutletContext} />
        </main>
      </div>
    </div>
  );
}
