import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStaticDataSource } from './staticDataSource';

describe('createStaticDataSource', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('reads the file JSON from a path-encoded location under the base path', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ path: 'local/a.md' }) });
    const ds = createStaticDataSource('/base/');
    await ds.getFile('ws', 'local/a.md');
    expect(globalThis.fetch).toHaveBeenCalledWith('/base/data/files/local/a.md.json');
  });

  it('filters the pre-built search index client-side', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [
        { workspace_id: 'ws', source_id: 'local', path: 'a.md', title: 'Alpha', snippet: 'alpha content', score: 0 },
        { workspace_id: 'ws', source_id: 'local', path: 'b.md', title: 'Beta', snippet: 'beta content', score: 0 },
      ],
    });
    const ds = createStaticDataSource('/base/');
    const results = await ds.search('ws', 'alpha');
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('a.md');
  });

  it('returns no results for an empty query without fetching the index', async () => {
    const ds = createStaticDataSource('/base/');
    const results = await ds.search('ws', '  ');
    expect(results).toEqual([]);
  });
});
