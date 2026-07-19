import { createBrowserRouter } from 'react-router-dom';
import { WorkspacePickerPage } from './WorkspacePickerPage';
import { WorkspaceLayout } from './WorkspaceLayout';
import { FileViewerPage } from './FileViewerPage';

export const router = createBrowserRouter([
  { path: '/', element: <WorkspacePickerPage /> },
  {
    path: '/w/:workspaceId',
    element: <WorkspaceLayout />,
    children: [{ path: 'doc/*', element: <FileViewerPage /> }],
  },
]);
