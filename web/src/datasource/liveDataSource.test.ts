import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLiveDataSource } from './liveDataSource';

describe('createLiveDataSource', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('fetches the tree from the correct URL', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'WS', path: '', is_dir: true, children: [] }),
    });
    const ds = createLiveDataSource();
    await ds.getTree('ws');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspaces/ws/tree');
  });

  it('URL-encodes the file path query param', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) });
    const ds = createLiveDataSource();
    await ds.getFile('ws', 'local/a b.md');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspaces/ws/file?path=local%2Fa%20b.md');
  });

  it('throws on a non-ok response', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    const ds = createLiveDataSource();
    await expect(ds.getTree('ws')).rejects.toThrow(/404/);
  });
});

describe('createLiveDataSource subscribeToChanges', () => {
  class MockEventSource {
    static instances: MockEventSource[] = [];
    onopen: (() => void) | null = null;
    listeners: Record<string, ((ev: any) => void)[]> = {};
    closed = false;
    constructor(public url: string) {
      MockEventSource.instances.push(this);
    }
    addEventListener(name: string, cb: (ev: any) => void) {
      (this.listeners[name] ??= []).push(cb);
    }
    close() {
      this.closed = true;
    }
    emit(name: string, data: unknown) {
      for (const cb of this.listeners[name] ?? []) cb({ data: JSON.stringify(data) });
    }
  }

  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  it('opens an EventSource at the workspace events URL and forwards change events', () => {
    const ds = createLiveDataSource();
    const onEvent = vi.fn();
    ds.subscribeToChanges('ws', onEvent, vi.fn());

    const es = MockEventSource.instances[0];
    expect(es.url).toBe('/api/workspaces/ws/events');
    es.emit('change', { sourceId: 'local', path: 'a.md', op: 'modify' });
    expect(onEvent).toHaveBeenCalledWith({ sourceId: 'local', path: 'a.md', op: 'modify' });
  });

  it('calls onResync on reopen after the first open, but not on the first open', () => {
    const ds = createLiveDataSource();
    const onResync = vi.fn();
    ds.subscribeToChanges('ws', vi.fn(), onResync);

    const es = MockEventSource.instances[0];
    es.onopen?.();
    expect(onResync).not.toHaveBeenCalled();

    es.onopen?.();
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it('the returned cleanup closes the EventSource', () => {
    const ds = createLiveDataSource();
    const cleanup = ds.subscribeToChanges('ws', vi.fn(), vi.fn());
    const es = MockEventSource.instances[0];
    cleanup();
    expect(es.closed).toBe(true);
  });
});

describe('createLiveDataSource getFileDiff', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('fetches the diff URL with source and path query params', async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ available: false }) });
    const ds = createLiveDataSource();
    await ds.getFileDiff('ws', 'local', 'a b.md');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/workspaces/ws/file/diff?path=a%20b.md&source=local');
  });
});
