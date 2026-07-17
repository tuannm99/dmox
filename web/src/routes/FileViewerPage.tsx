import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import { MarkdownView } from '../components/MarkdownView';
import { GitHistoryPanel } from '../components/GitHistoryPanel';
import type { FileView } from '../datasource/types';

export function FileViewerPage() {
  const { workspaceId = '', '*': wildcardPath = '' } = useParams();
  const ds = useDataSource();
  const [file, setFile] = useState<FileView | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) return <div className="error">Failed to load file: {error}</div>;
  if (!file) return <div className="loading">Loading…</div>;

  return (
    <article>
      {file.is_ai_context && <div className="ai-context-badge">AI Context File</div>}
      <h1>{file.title}</h1>
      <MarkdownView body={file.body} />
      <GitHistoryPanel workspaceId={workspaceId} path={wildcardPath} />
    </article>
  );
}
