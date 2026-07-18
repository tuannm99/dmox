import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import type { Workspace } from '../datasource/types';

export function WorkspacePickerPage() {
  const ds = useDataSource();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);

  useEffect(() => {
    ds.listWorkspaces().then(setWorkspaces);
  }, [ds]);

  if (workspaces === null) return <div className="loading">Loading…</div>;
  if (workspaces.length === 0) return <div className="empty">No workspaces configured.</div>;

  return (
    <ul className="workspace-picker">
      {workspaces.map((w) => (
        <li key={w.id}>
          <Link to={`/w/${w.id}`}>{w.name}</Link>
        </li>
      ))}
    </ul>
  );
}
