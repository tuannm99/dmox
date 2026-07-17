import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import type { SearchResult } from '../datasource/types';

export function SearchPage() {
  const { workspaceId = '' } = useParams();
  const ds = useDataSource();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      ds.search(workspaceId, query).then(
        (r) => !cancelled && setResults(r),
        (e) => !cancelled && setError(String(e))
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [ds, workspaceId, query]);

  return (
    <div className="search-page">
      <input
        autoFocus
        placeholder="Search this workspace…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <div className="error">{error}</div>}
      <ul className="search-results">
        {results.map((r) => (
          <li key={`${r.source_id}/${r.path}`}>
            <Link to={`/w/${workspaceId}/doc/${r.source_id}/${r.path}`}>{r.title}</Link>
            <p dangerouslySetInnerHTML={{ __html: r.snippet }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
