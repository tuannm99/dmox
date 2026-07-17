import type {
  DataSource, TreeNode, FileView, SearchResult, AIContextEntry, Workspace,
  GitHistoryResult, GitBlameResult,
} from './types';

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`dmox static asset error ${res.status}: ${url}`);
  }
  return res.json() as Promise<T>;
}

function encodePathSegments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function createStaticDataSource(basePath: string = import.meta.env.BASE_URL): DataSource {
  const root = basePath.replace(/\/$/, '');
  return {
    listWorkspaces: () => getJSON<Workspace[]>(`${root}/data/workspaces.json`),
    getTree: () => getJSON<TreeNode>(`${root}/data/tree.json`),
    getFile: (_workspaceId, path) => getJSON<FileView>(`${root}/data/files/${encodePathSegments(path)}.json`),
    search: async (_workspaceId, query) => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const index = await getJSON<SearchResult[]>(`${root}/data/search-index.json`);
      return index.filter((r) => r.title.toLowerCase().includes(q) || r.snippet.toLowerCase().includes(q));
    },
    getAIContext: () => getJSON<AIContextEntry[]>(`${root}/data/ai-context.json`),
    getGitHistory: async (_workspaceId, path) => {
      const all = await getJSON<Record<string, GitHistoryResult>>(`${root}/data/git-history.json`);
      return all[path] ?? { applicable: false, commits: [] };
    },
    getGitBlame: async (_workspaceId, path) => {
      const all = await getJSON<Record<string, GitBlameResult>>(`${root}/data/git-history.json`);
      return all[`${path}#blame`] ?? { applicable: false, lines: [] };
    },
  };
}
