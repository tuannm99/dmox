import type {
  DataSource, TreeNode, FileView, SearchResult, AIContextEntry, Workspace,
  GitHistoryResult, GitBlameResult, ChangeEvent, FileDiff,
} from './types';

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`dmox api error ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export function createLiveDataSource(baseURL = ''): DataSource {
  return {
    listWorkspaces: () => getJSON<Workspace[]>(`${baseURL}/api/workspaces`),
    getTree: (workspaceId) => getJSON<TreeNode>(`${baseURL}/api/workspaces/${workspaceId}/tree`),
    getFile: (workspaceId, path) =>
      getJSON<FileView>(`${baseURL}/api/workspaces/${workspaceId}/file?path=${encodeURIComponent(path)}`),
    search: (workspaceId, query) =>
      getJSON<SearchResult[]>(`${baseURL}/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(query)}`),
    getAIContext: (workspaceId) => getJSON<AIContextEntry[]>(`${baseURL}/api/workspaces/${workspaceId}/ai-context`),
    getGitHistory: (workspaceId, path) =>
      getJSON<GitHistoryResult>(`${baseURL}/api/workspaces/${workspaceId}/git/history?path=${encodeURIComponent(path)}`),
    getGitBlame: (workspaceId, path) =>
      getJSON<GitBlameResult>(`${baseURL}/api/workspaces/${workspaceId}/git/blame?path=${encodeURIComponent(path)}`),
    subscribeToChanges: (workspaceId, onEvent, onResync) => {
      const es = new EventSource(`${baseURL}/api/workspaces/${workspaceId}/events`);
      let opened = false;
      es.onopen = () => {
        if (opened) onResync();
        opened = true;
      };
      es.addEventListener('change', (e) => {
        onEvent(JSON.parse((e as MessageEvent).data) as ChangeEvent);
      });
      return () => es.close();
    },
    getFileDiff: (workspaceId, sourceId, path) =>
      getJSON<FileDiff>(
        `${baseURL}/api/workspaces/${workspaceId}/file/diff?path=${encodeURIComponent(path)}&source=${encodeURIComponent(sourceId)}`
      ),
  };
}
