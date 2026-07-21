import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import { MarkdownView } from '../components/MarkdownView';
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
  useEffect(() => {
    if (file) outletContext?.resetScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Reset the deleted-banner whenever we navigate to a different file — it
  // must not persist onto the next file just because it was set on this one.
  useEffect(() => {
    setDeleted(false);
  }, [wildcardPath]);

  // React to a live-change event for the currently-open file (already
  // pre-filtered by WorkspaceLayout to match this file's path). A delete
  // shows a persistent banner; a modify/create refetches in place and
  // restores the scroll position afterwards via requestAnimationFrame, which
  // runs after the [file]-effect above has already fired resetScroll for
  // this same update, so our restore wins and is the final scroll position.
  useEffect(() => {
    const ev = outletContext?.fileChangeEvent;
    if (!ev) return;
    if (ev.op === 'delete') {
      setDeleted(true);
      return;
    }
    const scrollEl = outletContext?.contentRef?.current;
    const prevScrollTop = scrollEl?.scrollTop ?? 0;
    ds.getFile(workspaceId, wildcardPath).then((f) => {
      setFile(f);
      if (scrollEl) {
        requestAnimationFrame(() => {
          scrollEl.scrollTop = prevScrollTop;
        });
      }
    });
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
      <MarkdownView body={file.body} workspaceId={workspaceId} currentPath={wildcardPath} />
      <GitHistoryPanel workspaceId={workspaceId} path={wildcardPath} />
    </article>
  );
}
