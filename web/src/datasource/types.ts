export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: TreeNode[];
}

export interface FileView {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  headings: { level: number; text: string; slug: string }[];
  is_ai_context: boolean;
}

export interface SearchResult {
  workspace_id: string;
  source_id: string;
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface AIContextEntry {
  source_id: string;
  path: string;
  title: string;
}

export interface Commit {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export interface BlameLine {
  line_no: number;
  hash: string;
  author: string;
  date: string;
  text: string;
}

export interface Workspace {
  id: string;
  name: string;
}

export interface GitHistoryResult {
  applicable: boolean;
  commits: Commit[];
}

export interface GitBlameResult {
  applicable: boolean;
  lines: BlameLine[];
}

export interface ChangeEvent {
  sourceId: string;
  path: string;
  op: 'create' | 'modify' | 'delete';
}

export interface FileDiff {
  available: boolean;
  old?: string;
  new?: string;
}

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'copied' | 'conflicted';

export interface GitFileEntry {
  /** Relative to the source root, matching the doc tree's paths. */
  path: string;
  status: GitFileStatus;
  staged: boolean;
}

export interface GitSourceStatus {
  /** False when the source isn't inside a git checkout — an ordinary state,
   *  e.g. a docs/ directory mounted on its own without the surrounding repo. */
  applicable: boolean;
  branch: string;
  detached: boolean;
  files: GitFileEntry[];
}

export interface GitStatus {
  sources: Record<string, GitSourceStatus>;
}

export interface DataSource {
  listWorkspaces(): Promise<Workspace[]>;
  getTree(workspaceId: string): Promise<TreeNode>;
  getFile(workspaceId: string, path: string): Promise<FileView>;
  search(workspaceId: string, query: string): Promise<SearchResult[]>;
  getAIContext(workspaceId: string): Promise<AIContextEntry[]>;
  getGitHistory(workspaceId: string, path: string): Promise<GitHistoryResult>;
  getGitBlame(workspaceId: string, path: string): Promise<GitBlameResult>;
  getGitStatus(workspaceId: string): Promise<GitStatus>;
  getGitWorkingDiff(workspaceId: string, path: string): Promise<FileDiff>;
  subscribeToChanges(workspaceId: string, onEvent: (ev: ChangeEvent) => void, onResync: () => void): () => void;
  getFileDiff(workspaceId: string, sourceId: string, path: string): Promise<FileDiff>;
}
