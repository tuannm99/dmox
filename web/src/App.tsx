import { RouterProvider } from 'react-router-dom';
import { DataSourceProvider } from './datasource/context';
import { router } from './routes/router';
import './styles.css';

export function App() {
  return (
    <DataSourceProvider>
      <RouterProvider router={router} />
    </DataSourceProvider>
  );
}
