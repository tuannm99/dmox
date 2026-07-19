import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import { TreeView } from '../components/TreeView';
import type { TreeNode } from '../datasource/types';
import { RightPanel } from '../components/RightPanel';
import { TerminalPanel } from '../components/TerminalPanel';
import { SearchPanel } from '../components/SearchPanel';
import { AIContextPanel } from '../components/AIContextPanel';
import { defaultKeymap, mergeKeymap, matches, fetchKeymapOverrides, type PanelKind, type Keymap } from '../keymap';

export interface WorkspaceOutletContext {
  tree: TreeNode;
  scrollToTop: () => void;
  resetScroll: () => void;
}

const SIDEBAR_WIDTH_KEY = 'dmox-sidebar-width';
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 260;

function readStoredSidebarWidth(): number {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return stored >= MIN_SIDEBAR_WIDTH && stored <= MAX_SIDEBAR_WIDTH ? stored : DEFAULT_SIDEBAR_WIDTH;
}

function panelTitle(kind: PanelKind | null): string {
  switch (kind) {
    case 'terminal':
      return 'Terminal';
    case 'search':
      return 'Search';
    case 'ai-context':
      return 'AI Context';
    default:
      return '';
  }
}

export function WorkspaceLayout() {
  const { workspaceId = '' } = useParams();
  const ds = useDataSource();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [dragging, setDragging] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelKind | null>(null);
  const [openedPanels, setOpenedPanels] = useState<Set<PanelKind>>(new Set());
  const [keymap, setKeymap] = useState<Keymap>(defaultKeymap);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const docPrefix = `/w/${workspaceId}/doc/`;
  const currentPath = location.pathname.startsWith(docPrefix) ? location.pathname.slice(docPrefix.length) : undefined;

  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setError(null);
    setActivePanel(null);
    setOpenedPanels(new Set());
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

  useEffect(() => {
    let cancelled = false;
    fetchKeymapOverrides().then((overrides) => {
      if (!cancelled) setKeymap(mergeKeymap(overrides));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePanel = useCallback((kind: PanelKind) => {
    setActivePanel((current) => (current === kind ? null : kind));
    setOpenedPanels((s) => (s.has(kind) ? s : new Set(s).add(kind)));
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      for (const kind of Object.keys(keymap) as PanelKind[]) {
        if (matches(e, keymap[kind])) {
          e.preventDefault();
          togglePanel(kind);
          return;
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [keymap, togglePanel]);

  const resetScroll = useCallback(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, []);

  // Scroll the content pane back to the top on every navigation (search,
  // ai-context, terminal) — .content is its own scroll container now, so the
  // browser's default scroll-to-top-on-navigate behavior (which only applies
  // to window scroll) doesn't reach it. FileViewerPage handles its own reset
  // once its file data has actually loaded (see resetScroll usage there) —
  // resetting here immediately on path change races with its Loading-state
  // content swap and can get undone by the browser's scroll-anchoring.
  useEffect(() => {
    resetScroll();
  }, [location.pathname, resetScroll]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    function onScroll() {
      setShowScrollTop(el!.scrollTop > 300);
    }
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [tree]);

  const scrollToTop = useCallback(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  if (error) return <div className="error">Failed to load workspace: {error}</div>;
  if (!tree) return <div className="loading">Loading…</div>;

  return (
    <div className={dragging ? 'workspace-shell resizing' : 'workspace-shell'}>
      <nav className="topnav">
        <Link to={`/w/${workspaceId}`}>{tree.name}</Link>
        <button type="button" aria-pressed={activePanel === 'search'} onClick={() => togglePanel('search')}>
          Search
        </button>
        <button type="button" aria-pressed={activePanel === 'ai-context'} onClick={() => togglePanel('ai-context')}>
          AI Context
        </button>
        <button type="button" aria-pressed={activePanel === 'terminal'} onClick={() => togglePanel('terminal')}>
          Terminal
        </button>
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
        <main className="content" ref={contentRef}>
          <Outlet context={{ tree, scrollToTop, resetScroll } satisfies WorkspaceOutletContext} />
        </main>
        {openedPanels.size > 0 && (
          <RightPanel open={activePanel !== null} title={panelTitle(activePanel)} onClose={() => setActivePanel(null)}>
            {openedPanels.has('terminal') && (
              <div hidden={activePanel !== 'terminal'} className="right-panel-pane">
                <TerminalPanel workspaceId={workspaceId} toggleBinding={keymap.terminal} />
              </div>
            )}
            {openedPanels.has('search') && (
              <div hidden={activePanel !== 'search'} className="right-panel-pane">
                <SearchPanel workspaceId={workspaceId} onNavigate={() => setActivePanel(null)} />
              </div>
            )}
            {openedPanels.has('ai-context') && (
              <div hidden={activePanel !== 'ai-context'} className="right-panel-pane">
                <AIContextPanel workspaceId={workspaceId} onNavigate={() => setActivePanel(null)} />
              </div>
            )}
          </RightPanel>
        )}
        {showScrollTop && (
          <button type="button" className="scroll-to-top" onClick={scrollToTop}>
            ↑ Top
          </button>
        )}
      </div>
    </div>
  );
}
