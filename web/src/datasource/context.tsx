import { createContext, useContext, type ReactNode } from 'react';
import type { DataSource } from './types';
import { createLiveDataSource } from './liveDataSource';
import { createStaticDataSource } from './staticDataSource';

const DataSourceContext = createContext<DataSource | null>(null);

export function resolveDataSource(): DataSource {
  const mode = import.meta.env.VITE_DATA_SOURCE ?? 'live';
  return mode === 'static' ? createStaticDataSource() : createLiveDataSource();
}

export function DataSourceProvider({ children }: { children: ReactNode }) {
  return <DataSourceContext.Provider value={resolveDataSource()}>{children}</DataSourceContext.Provider>;
}

export function useDataSource(): DataSource {
  const ds = useContext(DataSourceContext);
  if (!ds) throw new Error('useDataSource must be used within DataSourceProvider');
  return ds;
}
