# Realtime sync: Local → UI (Spec 1 of 2)

Status: approved for planning
Related: `docs/roadmap/2026-07-20-technical-backlog.md` item 4 ("Realtime sync
local files"). That backlog item asked for bidirectional sync with editor
conflict handling; this spec covers only the Local → UI direction. The
UI → Local direction (in-app editing, write-back, conflict resolution) is a
separate follow-up spec that depends on the event plumbing built here, and
is out of scope for this document.

## Problem

`dmox serve` already detects filesystem changes: `LocalSource.Watch()`
(`internal/source/local.go`) uses `fsnotify` with a 300ms debounce and feeds
`cmd/dmox/serve.go`'s `watchAndReindex`, which keeps the SQLite index
current. But nothing tells the frontend this happened. A user editing docs
in an external editor, checking out a different git branch, or having
another tool touch the workspace sees no update until they manually reload
the page — at which point the tree also loses scroll position and the open
file is lost (tracked separately as backlog item 1, "Preserve UI state after
reload").

This spec makes already-detected backend changes visible in the UI in near
real time, and lets the user see what changed via a diff against the last
version they saw.

## Non-goals

- No in-app editing or write-back (`DMOX never writes back to a Source`,
  `internal/source/source.go` — this spec does not change that).
- No changes to `dmox build` static export — live-reload only applies to
  `dmox serve`.
- No incremental/surgical tree patching — full tree refetch on change is
  the deliberate v1 approach (see Frontend components).
- No cross-session/durable event history — the event hub and diff cache are
  in-memory only, scoped to the running `serve` process.

## Architecture

```
fsnotify -> LocalSource.Watch() -> ChangeEvent channel (existing)
                                        |
                                        v
                          watchAndReindex (cmd/dmox/serve.go)
                             | capture old body (Store.GetFileBody)
                             | reindex (Indexer.IndexFile, existing)
                             | record diff (livesync.DiffCache)
                             v
                       livesync.Hub.Publish(workspaceID, Event)
                                        |
                                        v
                    GET /api/workspaces/:id/events (SSE, new)
                                        |
                                        v
                 web: DataSource.subscribeToChanges (new)
                        |            |             |
                        v            v             v
                   TreeView    FileViewerPage   ToastStack -> DiffModal
                  (refetch)   (refetch/banner)   (GET /file/diff, new)
```

## Backend components

### `internal/livesync` (new package)

Two independent, separately-testable pieces:

**`Hub`** — in-memory pub/sub keyed by `workspaceID`.

```go
type Event struct {
    SourceID string
    Path     string
    Op       source.ChangeOp
}

type Hub struct { /* mu sync.Mutex; subs map[string]map[chan Event]struct{} */ }

func NewHub() *Hub
func (h *Hub) Publish(workspaceID string, ev Event)
func (h *Hub) Subscribe(workspaceID string) (ch <-chan Event, cancel func())
```

Each subscriber gets its own buffered channel (capacity 16, matching the
existing `ChangeEvent` channel buffer in `local.go`). A slow/stuck
subscriber that fills its buffer has the oldest pending event dropped
(non-blocking send) rather than blocking `Publish` for other subscribers —
acceptable because the SSE reconnect/resync path (below) recovers from
missed events.

**`DiffCache`** — in-memory map from `(workspaceID, sourceID, path)` to
`{old, new string}`.

```go
type DiffCache struct { /* mu sync.Mutex; entries map[key]diffEntry; order []key (insertion order, for cap eviction) */ }

func NewDiffCache(cap int) *DiffCache
func (c *DiffCache) Record(workspaceID, sourceID, path, old, new string)
func (c *DiffCache) Consume(workspaceID, sourceID, path string) (old, new string, available bool)
```

`Record` semantics: if no unconsumed entry exists for the key, create one
with the given `old`/`new`. If an unconsumed entry already exists, keep its
original `old` and overwrite `new` — so the diff always represents
everything that changed since the user last actually viewed it. `Consume`
returns and deletes the entry. Cap defaults to 200 entries per *workspace*
(tracked via per-workspace insertion order); when a workspace's count would
exceed the cap, its oldest unconsumed entry is evicted before adding the
new one.

### `internal/store`

Add one read helper alongside the existing `files` table access in
`internal/index/indexer.go`:

```go
func (s *Store) GetFileBody(ctx context.Context, workspaceID, sourceID, path string) (body string, ok bool, err error)
```

Simple `SELECT body FROM files WHERE workspace_id=? AND source_id=? AND path=?`.

### `internal/app`

`App` gains two fields, constructed in `New()` next to `Store`/`Indexer`:

```go
Events *livesync.Hub
Diffs  *livesync.DiffCache
```

### `cmd/dmox/serve.go`

`watchAndReindex` changes from a pure reindex loop to also snapshot the
pre-change body and publish an event:

```go
func watchAndReindex(ctx context.Context, a *app.App, wsID string, src source.Source, events <-chan source.ChangeEvent) {
    for ev := range events {
        old, hadOld, _ := a.Store.GetFileBody(ctx, wsID, src.ID(), ev.Path)

        if err := a.Indexer.IndexFile(ctx, wsID, src, ev.Path); err != nil {
            log.Printf("reindex %s/%s/%s failed: %v", wsID, src.ID(), ev.Path, err)
            continue
        }

        if ev.Op != source.ChangeOpDelete {
            if newBody, ok, _ := a.Store.GetFileBody(ctx, wsID, src.ID(), ev.Path); ok {
                oldBody := ""
                if hadOld {
                    oldBody = old
                }
                a.Diffs.Record(wsID, src.ID(), ev.Path, oldBody, newBody)
            }
        }

        a.Events.Publish(wsID, livesync.Event{SourceID: src.ID(), Path: ev.Path, Op: ev.Op})
    }
}
```

Create naturally yields `hadOld == false` → `oldBody == ""` → the diff
shows the whole file as added, with no special-case branch needed. Delete
publishes an event but never records a diff entry (nothing to compare).

### API (`internal/api`)

**`GET /api/workspaces/:id/events`** — SSE stream (`Content-Type:
text/event-stream`). Subscribes to `a.Events` for the workspace ID;
`for` loop writes each `Event` as:

```
event: change
data: {"sourceId":"docs","path":"foo/bar.md","op":"modify"}

```

Flushes after every write (`http.Flusher`). Exits and unsubscribes when
`c.Request.Context().Done()` fires (client disconnect).

**`GET /api/workspaces/:id/file/diff?path=...`** — reads `?source=` the
same way `handleTerminalWS` resolves a source (defaulting to the first
local source if omitted, since diffs only apply to locally-watched files).
Calls `a.Diffs.Consume(...)`, responds:

```json
{ "available": true, "old": "...", "new": "..." }
```

or `{ "available": false }` if no entry exists (already consumed, server
restarted since, or the change predates this feature).

## Frontend components

### `DataSource` interface (`web/src/datasource/types.ts`)

```ts
export interface ChangeEvent {
  sourceId: string;
  path: string;
  op: 'create' | 'modify' | 'delete';
}

// in DataSource:
subscribeToChanges(
  workspaceId: string,
  onEvent: (ev: ChangeEvent) => void,
  onResync: () => void,
): () => void; // returns cleanup
```

- **`liveDataSource`**: opens `new EventSource(`${baseURL}/api/workspaces/${workspaceId}/events`)`.
  `change` events are JSON-parsed and passed to `onEvent`. `onResync` fires
  on every `onopen` *after* the first one — `EventSource`'s built-in retry
  means a reopen is the only signal available that a gap may have occurred,
  so each reopen is treated as a resync opportunity. Returned cleanup calls
  `es.close()`.
- **`staticDataSource`**: returns `() => {}` immediately and never calls
  `onEvent`/`onResync` — correct behavior for a frozen static export, not a
  stub.

### `WorkspaceLayout.tsx`

Calls `subscribeToChanges` once per active workspace. Fans events out to:

- **`TreeView`**: on any event, debounce (~200ms, coalescing bursts from the
  existing 300ms backend debounce plus multi-file operations) then refetch
  `ds.getTree()`. No incremental tree patching in v1 — full refetch is
  simpler and cheap at the scale DMOX targets; incremental/large-repo
  optimization is already tracked separately under "Future enhancements" in
  the backlog. Existing `path`-keyed rendering means the sidebar's scroll
  position is not disturbed by the refetch (React reconciles rather than
  remounting).
- **`FileViewerPage`**: if an event's `(sourceId, path)` matches the open
  file: `modify`/`create` → refetch `ds.getFile()`, preserving the content
  container's `scrollTop` across the update; `delete` → show a persistent
  inline banner ("This file was deleted") instead of navigating away.
- **`ToastStack`** (new component, mounted in `WorkspaceLayout`, fixed
  bottom-right, independent of the Right Panel dock since it's transient
  notification rather than a persistent tool): one toast per changed path,
  auto-dismiss after ~4s, with a "View diff" action present only when
  `op !== 'delete'`.
- **`DiffModal`** (new component): "View diff" fetches
  `/file/diff?path=...`; if `available`, runs `diffLines(old, new)` from
  the `diff` npm package (new dependency — not currently in
  `web/package.json`) and renders a unified diff (removed lines red, added
  lines green, directly above/below each other, GitHub-diff style); if not
  `available`, shows "No previous version to compare."

## Error handling

- SSE disconnect: handled by the browser's native `EventSource` retry; each
  reopen triggers the resync callback (full tree + open-file refetch) to
  cover events possibly missed while disconnected.
- Backend unsubscribes a connection's channel from `Hub` on client
  disconnect (`context.Done()`) to avoid goroutine/channel leaks.
- Multiple tabs on the same workspace: each gets an independent
  `EventSource` and `Hub` subscriber; no shared state or conflict.
- Missing diff cache entry (consumed already, server restarted, or change
  predates this feature): endpoint returns `available: false`, UI shows a
  message instead of erroring.

## Testing

**Go:**
- `internal/livesync`: `Hub` (publish/subscribe, multiple subscribers,
  unsubscribe stops delivery, slow-subscriber drop behavior), `DiffCache`
  (record, extend-on-repeat-change, consume-clears, cap eviction).
- `internal/store`: `GetFileBody` (found/not-found cases).
- `internal/api`: SSE handler test via `httptest` — publish on the hub,
  assert the expected `data:` line appears in the streamed response;
  `/file/diff` handler test for available/unavailable cases.

**Vitest:**
- `liveDataSource.subscribeToChanges`: mock `EventSource`, verify event
  forwarding and resync-on-reopen (but not on first open).
- `staticDataSource.subscribeToChanges`: confirm no-op.
- `TreeView`: refetch triggered on event, debounced.
- `FileViewerPage`: refetch-preserves-scroll on modify; banner on delete.
- `DiffModal`: renders a correct unified diff from sample old/new strings,
  and the "unavailable" message when `available: false`.

**Manual verification:** run `dmox serve`, edit a file on disk directly,
confirm tree/toast/diff behave as designed. Not automated in Playwright —
filesystem-event timing makes this flaky in CI, and no existing e2e test in
this repo depends on real-time fs events.
