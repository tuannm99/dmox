import type {
  DataSource, TreeNode, FileView, SearchResult, AIContextEntry, Workspace,
  GitHistoryResult, GitBlameResult, ChangeEvent, FileDiff, GitStatus,
} from './types';

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`dmox api error ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// Diff fetches are backed by a consume-once server-side cache (GET
// /file/diff deletes the entry it returns), so two concurrent requests for
// the same URL must not both hit the network — the second would always find
// the entry already gone. React StrictMode's dev-mode double-invoke of
// effects (mount -> cleanup -> mount) is exactly this shape: DiffModal's
// fetch effect can fire getFileDiff twice back-to-back before either
// resolves. Deduplicating in-flight requests here (module scope, so it
// survives across multiple createLiveDataSource() calls within one page
// load, e.g. if a provider using it is itself double-invoked) makes the two
// calls share one real HTTP request instead of racing each other.
const inFlightDiffRequests = new Map<string, Promise<FileDiff>>();

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
    getGitStatus: (workspaceId) => getJSON<GitStatus>(`${baseURL}/api/workspaces/${workspaceId}/git/status`),
    getGitWorkingDiff: (workspaceId, path) =>
      getJSON<FileDiff>(`${baseURL}/api/workspaces/${workspaceId}/git/working-diff?path=${encodeURIComponent(path)}`),
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
    getFileDiff: (workspaceId, sourceId, path) => {
      const url = `${baseURL}/api/workspaces/${workspaceId}/file/diff?path=${encodeURIComponent(path)}&source=${encodeURIComponent(sourceId)}`;
      const existing = inFlightDiffRequests.get(url);
      if (existing) return existing;
      const request = getJSON<FileDiff>(url).finally(() => inFlightDiffRequests.delete(url));
      inFlightDiffRequests.set(url, request);
      return request;
    },
  };
}
