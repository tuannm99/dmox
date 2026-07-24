import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigationType, useOutletContext, useParams } from 'react-router-dom';
import { readScrollTop, restoreScrollTop, saveScrollTop } from '../scrollMemory';
import { useDataSource } from '../datasource/context';
import { MarkdownView } from '../components/MarkdownView';
import { CodeView } from '../components/CodeView';
import { GitHistoryPanel } from '../components/GitHistoryPanel';
import { flattenLeaves } from '../components/TreeView';
import type { WorkspaceOutletContext } from './WorkspaceLayout';
import type { FileView } from '../datasource/types';

export function FileViewerPage() {
  const { workspaceId = '', '*': wildcardPath = '' } = useParams();
  // Optional: FileViewerPage is also rendered directly (outside WorkspaceLayout's
  // Outlet) in some tests, where no context is provided — prev/next simply disable.
  const outletContext = useOutletContext<WorkspaceOutletContext | undefined>();
  const ds = useDataSource();
  const [file, setFile] = useState<FileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  // Set immediately before setFile() in the live-refetch (fileChangeEvent) path
  // below, and only there, so the [file]-effect can tell "this update is a
  // live in-place refresh of the same file" apart from "this update is a
  // genuine navigation to a different file" — see that effect for why.
  const suppressNextResetScrollRef = useRef(false);
  const navigationType = useNavigationType();
  const location = useLocation();
  const restoredForRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setError(null);
    ds.getFile(workspaceId, wildcardPath).then(
      (f) => !cancelled && setFile(f),
      (e) => !cancelled && setError(String(e))
    );
    return () => {
      cancelled = true;
    };
  }, [ds, workspaceId, wildcardPath]);

  // Reset scroll only once the new file has actually rendered — resetting at
  // click time races with the Loading-state content swap and gets fought by
  // the browser's scroll-anchoring, leaving the page stuck mid-scroll.
  //
  // This effect also fires for a live in-place refetch of the SAME file
  // (fileChangeEvent below also calls setFile, producing a new `file`
  // reference), where resetting to top would be wrong — we want to preserve
  // scroll position there instead. The fileChangeEvent effect sets
  // suppressNextResetScrollRef.current = true immediately before its setFile
  // call; we consume (and clear) that flag here instead of calling
  // resetScroll(), so the two effects cooperate deterministically regardless
  // of effect-flush/rAF scheduling order.
  // A reload or a back/forward (navigationType 'POP') should land you where
  // you left off; clicking into a doc is a fresh read and still starts at the
  // top. Guarded per path so a live-refetch or a re-render doesn't yank the
  // page back to a stale offset after you've scrolled away from it.
  useEffect(() => {
    if (!file) return;
    if (suppressNextResetScrollRef.current) {
      suppressNextResetScrollRef.current = false;
      return;
    }
    const el = outletContext?.contentRef?.current;
    const saved = readScrollTop(workspaceId, wildcardPath);
    // A reload or back/forward ('POP') restores, and so does clicking a tab —
    // WorkspaceLayout flags those navigations, because switching tabs must not
    // lose your place. Opening a file fresh from the tree carries no flag and
    // still starts at the top.
    const askedToRestore = (location.state as { restoreScroll?: boolean } | null)?.restoreScroll === true;
    if (el && saved > 0 && (navigationType === 'POP' || askedToRestore) && restoredForRef.current !== wildcardPath) {
      restoredForRef.current = wildcardPath;
      return restoreScrollTop(el, saved);
    }
    outletContext?.resetScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Remember where the reader got to. Debounced because scroll fires per
  // frame, and only attached once the file is on screen so the reset-to-top
  // above can't be recorded as a real position.
  useEffect(() => {
    const el = outletContext?.contentRef?.current;
    if (!el || !file) return;
    let timer: ReturnType<typeof setTimeout>;
    function onScroll() {
      clearTimeout(timer);
      timer = setTimeout(() => saveScrollTop(workspaceId, wildcardPath, el!.scrollTop), 150);
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, workspaceId, wildcardPath]);

  // Reset the deleted-banner whenever we navigate to a different file — it
  // must not persist onto the next file just because it was set on this one.
  useEffect(() => {
    setDeleted(false);
  }, [wildcardPath]);

  // React to a live-change event for the currently-open file (already
  // pre-filtered by WorkspaceLayout to match this file's path). A delete
  // shows a persistent banner; a modify/create refetches in place, clears any
  // stale deleted-banner (a create can follow a delete for the same path
  // while this page stays mounted), and restores the scroll position
  // afterwards via requestAnimationFrame. suppressNextResetScrollRef is set
  // right before setFile() so the [file]-effect above skips its resetScroll()
  // for this update instead of racing it.
  useEffect(() => {
    const ev = outletContext?.fileChangeEvent;
    if (!ev) return;
    if (ev.op === 'delete') {
      setDeleted(true);
      return;
    }
    const scrollEl = outletContext?.contentRef?.current;
    const prevScrollTop = scrollEl?.scrollTop ?? 0;
    ds.getFile(workspaceId, wildcardPath).then(
      (f) => {
        setDeleted(false);
        suppressNextResetScrollRef.current = true;
        setFile(f);
        if (scrollEl) {
          requestAnimationFrame(() => {
            scrollEl.scrollTop = prevScrollTop;
          });
        }
      },
      (e) => setError(String(e))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletContext?.fileChangeEvent]);

  const { prevPath, nextPath } = useMemo(() => {
    if (!outletContext?.tree) return { prevPath: undefined, nextPath: undefined };
    const leaves = flattenLeaves(outletContext.tree);
    const index = leaves.findIndex((l) => l.path === wildcardPath);
    return {
      prevPath: index > 0 ? leaves[index - 1].path : undefined,
      nextPath: index >= 0 && index < leaves.length - 1 ? leaves[index + 1].path : undefined,
    };
  }, [outletContext, wildcardPath]);

  if (error) return <div className="error">Failed to load file: {error}</div>;
  if (!file) return <div className="loading">Loading…</div>;
  if (deleted) {
    return (
      <article>
        <div className="doc-breadcrumb">{wildcardPath.split('/').join(' / ')}</div>
        <div className="file-deleted-banner">This file was deleted.</div>
      </article>
    );
  }

  return (
    <article>
      <div className="doc-breadcrumb">{wildcardPath.split('/').join(' / ')}</div>
      <nav className="doc-pager doc-pager-top">
        {prevPath ? (
          <Link className="doc-pager-link doc-pager-prev" to={`/w/${workspaceId}/doc/${prevPath}`}>
            ← Back
          </Link>
        ) : (
          <span className="doc-pager-link doc-pager-disabled">← Back</span>
        )}
        {nextPath ? (
          <Link className="doc-pager-link doc-pager-next" to={`/w/${workspaceId}/doc/${nextPath}`}>
            Next →
          </Link>
        ) : (
          <span className="doc-pager-link doc-pager-disabled">Next →</span>
        )}
      </nav>
      {file.is_ai_context && <div className="ai-context-badge">AI Context File</div>}
      <h1>{file.title}</h1>
      {file.kind === 'code' ? (
        <CodeView body={file.body} language={file.language} tooLargeToHighlight={file.tooLargeToHighlight} />
      ) : (
        <MarkdownView body={file.body} workspaceId={workspaceId} currentPath={wildcardPath} />
      )}
      <GitHistoryPanel workspaceId={workspaceId} path={wildcardPath} />
    </article>
  );
}
