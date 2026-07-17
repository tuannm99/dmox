import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import type { AIContextEntry } from '../datasource/types';

export function AIContextPage() {
  const { workspaceId = '' } = useParams();
  const ds = useDataSource();
  const [entries, setEntries] = useState<AIContextEntry[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ds.getAIContext(workspaceId).then(setEntries);
  }, [ds, workspaceId]);

  async function copyAll() {
    const files = await Promise.all(entries.map((e) => ds.getFile(workspaceId, `${e.source_id}/${e.path}`)));
    const text = files.map((f) => `# ${f.path}\n\n${f.body}`).join('\n\n---\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="ai-context-page">
      <button type="button" onClick={copyAll} disabled={entries.length === 0}>
        {copied ? 'Copied!' : `Copy all ${entries.length} as context`}
      </button>
      <ul>
        {entries.map((e) => (
          <li key={`${e.source_id}/${e.path}`}>
            <Link to={`/w/${workspaceId}/doc/${e.source_id}/${e.path}`}>{e.title}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
