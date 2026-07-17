import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLiveDataSource } from './liveDataSource';

describe('createLiveDataSource', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('fetches the tree from the correct URL', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'WS', path: '', is_dir: true, children: [] }),
    });
    const ds = createLiveDataSource();
    await ds.getTree('ws');
    expect(global.fetch).toHaveBeenCalledWith('/api/workspaces/ws/tree');
  });

  it('URL-encodes the file path query param', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) });
    const ds = createLiveDataSource();
    await ds.getFile('ws', 'local/a b.md');
    expect(global.fetch).toHaveBeenCalledWith('/api/workspaces/ws/file?path=local%2Fa%20b.md');
  });

  it('throws on a non-ok response', async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    const ds = createLiveDataSource();
    await expect(ds.getTree('ws')).rejects.toThrow(/404/);
  });
});
