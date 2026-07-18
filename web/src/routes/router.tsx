import { createBrowserRouter } from 'react-router-dom';
import { WorkspacePickerPage } from './WorkspacePickerPage';
import { WorkspaceLayout } from './WorkspaceLayout';
import { FileViewerPage } from './FileViewerPage';
import { SearchPage } from './SearchPage';
import { AIContextPage } from './AIContextPage';

export const router = createBrowserRouter([
  { path: '/', element: <WorkspacePickerPage /> },
  {
    path: '/w/:workspaceId',
    element: <WorkspaceLayout />,
    children: [
      { path: 'doc/*', element: <FileViewerPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'ai-context', element: <AIContextPage /> },
    ],
  },
]);
