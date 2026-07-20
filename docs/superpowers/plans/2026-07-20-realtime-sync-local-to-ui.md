# Realtime Sync: Local → UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push already-detected filesystem changes (via the existing `fsnotify` watcher) from `dmox serve` to the browser in near real time, so the tree, an open file view, and a diff-on-demand toast all stay current without a manual page reload.

**Architecture:** A new `internal/livesync` package holds an in-memory pub/sub `Hub` (per-workspace change events) and a `DiffCache` (old/new content snapshots). `cmd/dmox/serve.go`'s existing `watchAndReindex` loop publishes to the `Hub` and records diffs alongside its existing reindex work. A new SSE endpoint streams `Hub` events to the browser; a new diff endpoint serves `DiffCache` entries. The frontend adds `subscribeToChanges`/`getFileDiff` to its `DataSource` interface (implemented in both `liveDataSource` and `staticDataSource`), and `WorkspaceLayout` wires the subscription into tree refetches, a new `ToastStack`, a new `DiffModal`, and a per-file change signal passed to `FileViewerPage` via the existing outlet-context mechanism.

**Tech Stack:** Go (gin, existing `fsnotify`/`gin-contrib/sse` deps — no new Go dependency), React + TypeScript (Vite, vitest), new frontend dependency `diff` (npm) for unified-diff rendering.

## Global Constraints

- Backend build/test requires CGO + the `sqlite_fts5` tag: `CGO_ENABLED=1 go build -tags sqlite_fts5 ./...` / `CGO_ENABLED=1 go test -tags sqlite_fts5 ./...`. Plain `go build`/`go test` will fail or misbehave.
- `gofmt -l .` must report nothing before any commit.
- Frontend tests: `cd web && npx vitest run <file>` for a single file, `cd web && npm test` for the full suite.
- Any new data-fetching capability added to `DataSource` (`web/src/datasource/types.ts`) must be implemented in **both** `liveDataSource.ts` and `staticDataSource.ts` (CLAUDE.md architecture rule) — a static export has no live backend, so its implementation is a documented no-op, not a stub to fill in later.
- Follow the existing per-concern handler file convention in `internal/api` (`git_handlers.go`, `keymap_handlers.go`, `terminal_handlers.go`, ...) — new handlers go in a new `livesync_handlers.go`, not into `workspace_handlers.go`.
- Spec of record: `docs/superpowers/specs/2026-07-20-realtime-sync-local-to-ui-design.md`. Non-goals restated: no in-app editing/write-back, no `dmox build` changes, no incremental tree patching, no durable/cross-restart event history.
- Every commit in this plan is a small, working, tested increment — commit after each task's tests pass.

---

## Task 1: `internal/livesync.Hub` — pub/sub

**Files:**
- Create: `internal/livesync/hub.go`
- Test: `internal/livesync/hub_test.go`

**Interfaces:**
- Produces: `type Event struct { SourceID string; Path string; Op string }` (JSON tags `sourceId`, `path`, `op`), `func NewHub() *Hub`, `func (h *Hub) Publish(workspaceID string, ev Event)`, `func (h *Hub) Subscribe(workspaceID string) (<-chan Event, func())`.

- [ ] **Step 1: Write the failing tests**

```go
// internal/livesync/hub_test.go
package livesync

import "testing"

func TestHub_PublishDeliversToSubscriber(t *testing.T) {
	h := NewHub()
	ch, cancel := h.Subscribe("ws")
	defer cancel()

	h.Publish("ws", Event{SourceID: "local", Path: "guide.md", Op: "modify"})

	select {
	case ev := <-ch:
		if ev.SourceID != "local" || ev.Path != "guide.md" || ev.Op != "modify" {
			t.Fatalf("event = %+v", ev)
		}
	default:
		t.Fatal("expected event to be delivered synchronously (buffered channel)")
	}
}

func TestHub_PublishDoesNotCrossWorkspaces(t *testing.T) {
	h := NewHub()
	chA, cancelA := h.Subscribe("a")
	defer cancelA()
	chB, cancelB := h.Subscribe("b")
	defer cancelB()

	h.Publish("a", Event{SourceID: "local", Path: "x.md", Op: "modify"})

	select {
	case <-chA:
	default:
		t.Fatal("expected workspace a to receive its event")
	}
	select {
	case ev := <-chB:
		t.Fatalf("workspace b should not receive workspace a's event, got %+v", ev)
	default:
	}
}

func TestHub_MultipleSubscribersAllReceive(t *testing.T) {
	h := NewHub()
	ch1, cancel1 := h.Subscribe("ws")
	defer cancel1()
	ch2, cancel2 := h.Subscribe("ws")
	defer cancel2()

	h.Publish("ws", Event{SourceID: "local", Path: "x.md", Op: "create"})

	for _, ch := range []<-chan Event{ch1, ch2} {
		select {
		case <-ch:
		default:
			t.Fatal("expected all subscribers to receive the event")
		}
	}
}

func TestHub_CancelStopsDelivery(t *testing.T) {
	h := NewHub()
	ch, cancel := h.Subscribe("ws")
	cancel()

	h.Publish("ws", Event{SourceID: "local", Path: "x.md", Op: "delete"})

	select {
	case ev, ok := <-ch:
		if ok {
			t.Fatalf("expected no event after cancel, got %+v", ev)
		}
	default:
	}
}

func TestHub_SlowSubscriberDropsOldestRatherThanBlocking(t *testing.T) {
	h := NewHub()
	ch, cancel := h.Subscribe("ws")
	defer cancel()

	// Publish more than the internal buffer (16) without draining.
	for i := 0; i < 17; i++ {
		h.Publish("ws", Event{SourceID: "local", Path: itoaPath(i), Op: "modify"})
	}

	var got []Event
	for {
		select {
		case ev := <-ch:
			got = append(got, ev)
		default:
			goto done
		}
	}
done:
	if len(got) != 16 {
		t.Fatalf("buffered event count = %d, want 16", len(got))
	}
	if got[0].Path != itoaPath(1) {
		t.Fatalf("oldest retained event = %q, want %q (event 0 should have been dropped)", got[0].Path, itoaPath(1))
	}
	if got[15].Path != itoaPath(16) {
		t.Fatalf("newest retained event = %q, want %q", got[15].Path, itoaPath(16))
	}
}

func itoaPath(i int) string {
	digits := "0123456789"
	if i < 10 {
		return string(digits[i]) + ".md"
	}
	return string(digits[i/10]) + string(digits[i%10]) + ".md"
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/livesync/...`
Expected: FAIL — `undefined: NewHub` (package doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```go
// internal/livesync/hub.go
package livesync

import "sync"

// Event is a single filesystem change, already reindexed, ready to notify
// UI clients about. Op is one of "create", "modify", "delete".
type Event struct {
	SourceID string `json:"sourceId"`
	Path     string `json:"path"`
	Op       string `json:"op"`
}

const subscriberBuffer = 16

// Hub is an in-memory, per-process pub/sub of Events keyed by workspace ID.
// It has no durability: a subscriber that isn't connected when Publish runs
// simply misses that event. Callers needing to recover from gaps (e.g. after
// a dropped SSE connection) resync by refetching current state instead.
type Hub struct {
	mu   sync.Mutex
	subs map[string]map[chan Event]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[string]map[chan Event]struct{})}
}

// Publish fans ev out to every subscriber of workspaceID. A subscriber whose
// buffer is full has its oldest pending event dropped to make room, rather
// than blocking this call — the resync-on-reconnect path in the SSE handler
// covers gaps this can create.
func (h *Hub) Publish(workspaceID string, ev Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[workspaceID] {
		select {
		case ch <- ev:
		default:
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- ev:
			default:
			}
		}
	}
}

// Subscribe registers a new listener for workspaceID. The returned cancel
// func must be called (typically via defer) to unregister it; failing to
// call it leaks the channel's map entry for the lifetime of the process.
func (h *Hub) Subscribe(workspaceID string) (<-chan Event, func()) {
	ch := make(chan Event, subscriberBuffer)

	h.mu.Lock()
	if h.subs[workspaceID] == nil {
		h.subs[workspaceID] = make(map[chan Event]struct{})
	}
	h.subs[workspaceID][ch] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		delete(h.subs[workspaceID], ch)
		if len(h.subs[workspaceID]) == 0 {
			delete(h.subs, workspaceID)
		}
		h.mu.Unlock()
	}
	return ch, cancel
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/livesync/... -v`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
gofmt -l internal/livesync
git add internal/livesync/hub.go internal/livesync/hub_test.go
git commit -m "feat: add livesync.Hub for per-workspace change pub/sub"
```

---

## Task 2: `internal/livesync.DiffCache`

**Files:**
- Create: `internal/livesync/diffcache.go`
- Test: `internal/livesync/diffcache_test.go`

**Interfaces:**
- Produces: `func NewDiffCache(cap int) *DiffCache`, `func (c *DiffCache) Record(workspaceID, sourceID, path, oldBody, newBody string)`, `func (c *DiffCache) Consume(workspaceID, sourceID, path string) (oldBody, newBody string, available bool)`.

- [ ] **Step 1: Write the failing tests**

```go
// internal/livesync/diffcache_test.go
package livesync

import "testing"

func TestDiffCache_RecordThenConsume(t *testing.T) {
	c := NewDiffCache(200)
	c.Record("ws", "local", "guide.md", "old body", "new body")

	old, new_, available := c.Consume("ws", "local", "guide.md")
	if !available {
		t.Fatal("expected entry to be available")
	}
	if old != "old body" || new_ != "new body" {
		t.Fatalf("old=%q new=%q", old, new_)
	}
}

func TestDiffCache_ConsumeClearsEntry(t *testing.T) {
	c := NewDiffCache(200)
	c.Record("ws", "local", "guide.md", "old", "new")
	c.Consume("ws", "local", "guide.md")

	_, _, available := c.Consume("ws", "local", "guide.md")
	if available {
		t.Fatal("expected entry to be gone after first Consume")
	}
}

func TestDiffCache_ConsumeUnknownKeyIsUnavailable(t *testing.T) {
	c := NewDiffCache(200)
	_, _, available := c.Consume("ws", "local", "nope.md")
	if available {
		t.Fatal("expected unavailable for a key never recorded")
	}
}

func TestDiffCache_RepeatedRecordKeepsOriginalOldExtendsNew(t *testing.T) {
	c := NewDiffCache(200)
	c.Record("ws", "local", "guide.md", "v1", "v2")
	c.Record("ws", "local", "guide.md", "v2", "v3") // second change before anyone viewed the first

	old, new_, available := c.Consume("ws", "local", "guide.md")
	if !available {
		t.Fatal("expected entry to be available")
	}
	if old != "v1" {
		t.Fatalf("old = %q, want %q (original baseline preserved)", old, "v1")
	}
	if new_ != "v3" {
		t.Fatalf("new = %q, want %q (latest content)", new_, "v3")
	}
}

func TestDiffCache_DifferentWorkspacesOrSourcesAreIndependentKeys(t *testing.T) {
	c := NewDiffCache(200)
	c.Record("ws1", "local", "guide.md", "a", "b")
	c.Record("ws2", "local", "guide.md", "x", "y")

	old, new_, available := c.Consume("ws1", "local", "guide.md")
	if !available || old != "a" || new_ != "b" {
		t.Fatalf("ws1 entry = (%q, %q, %v)", old, new_, available)
	}
	old, new_, available = c.Consume("ws2", "local", "guide.md")
	if !available || old != "x" || new_ != "y" {
		t.Fatalf("ws2 entry = (%q, %q, %v)", old, new_, available)
	}
}

func TestDiffCache_EvictsOldestPerWorkspaceWhenOverCap(t *testing.T) {
	c := NewDiffCache(2)
	c.Record("ws", "local", "a.md", "", "a")
	c.Record("ws", "local", "b.md", "", "b")
	c.Record("ws", "local", "c.md", "", "c") // evicts a.md, the oldest unconsumed entry

	if _, _, available := c.Consume("ws", "local", "a.md"); available {
		t.Fatal("expected a.md to have been evicted")
	}
	if _, _, available := c.Consume("ws", "local", "b.md"); !available {
		t.Fatal("expected b.md to still be present")
	}
	if _, _, available := c.Consume("ws", "local", "c.md"); !available {
		t.Fatal("expected c.md to still be present")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/livesync/... -run TestDiffCache`
Expected: FAIL — `undefined: NewDiffCache`.

- [ ] **Step 3: Write the implementation**

```go
// internal/livesync/diffcache.go
package livesync

import "sync"

type diffKey struct {
	workspaceID string
	sourceID    string
	path        string
}

type diffEntry struct {
	oldBody string
	newBody string
}

// DiffCache holds, per (workspace, source, path), the content just before
// the most recent unconsumed change and the content after it — enough to
// render a diff on demand. Entries are cleared on Consume; a repeated
// Record before Consume extends newBody while keeping the original oldBody,
// so the diff always covers everything since the last time it was actually
// viewed. In-memory only: it does not survive a process restart.
type DiffCache struct {
	mu      sync.Mutex
	cap     int
	entries map[diffKey]diffEntry
	order   map[string][]diffKey // per-workspace insertion order, oldest first
}

func NewDiffCache(cap int) *DiffCache {
	return &DiffCache{
		cap:     cap,
		entries: make(map[diffKey]diffEntry),
		order:   make(map[string][]diffKey),
	}
}

func (c *DiffCache) Record(workspaceID, sourceID, path, oldBody, newBody string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := diffKey{workspaceID, sourceID, path}
	if existing, ok := c.entries[key]; ok {
		existing.newBody = newBody
		c.entries[key] = existing
		return
	}

	if c.cap > 0 && len(c.order[workspaceID]) >= c.cap {
		oldest := c.order[workspaceID][0]
		c.order[workspaceID] = c.order[workspaceID][1:]
		delete(c.entries, oldest)
	}

	c.entries[key] = diffEntry{oldBody: oldBody, newBody: newBody}
	c.order[workspaceID] = append(c.order[workspaceID], key)
}

func (c *DiffCache) Consume(workspaceID, sourceID, path string) (oldBody, newBody string, available bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := diffKey{workspaceID, sourceID, path}
	entry, ok := c.entries[key]
	if !ok {
		return "", "", false
	}
	delete(c.entries, key)

	order := c.order[workspaceID]
	for i, k := range order {
		if k == key {
			c.order[workspaceID] = append(order[:i], order[i+1:]...)
			break
		}
	}

	return entry.oldBody, entry.newBody, true
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/livesync/... -v`
Expected: PASS (all tests in the package, Hub + DiffCache).

- [ ] **Step 5: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
gofmt -l internal/livesync
git add internal/livesync/diffcache.go internal/livesync/diffcache_test.go
git commit -m "feat: add livesync.DiffCache for on-demand change diffs"
```

---

## Task 3: `Store.GetFileBody`

**Files:**
- Modify: `internal/store/store.go`
- Test: `internal/store/store_test.go` (new file — none exists yet)

**Interfaces:**
- Consumes: existing `files` table schema (`internal/store/store.go`'s `schema` const): columns `workspace_id, source_id, path, body, ...`.
- Produces: `func (s *Store) GetFileBody(ctx context.Context, workspaceID, sourceID, path string) (body string, ok bool, err error)`.

- [ ] **Step 1: Write the failing test**

```go
// internal/store/store_test.go
package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestStore_GetFileBody_FoundAndNotFound(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "dmox.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	ctx := context.Background()
	_, err = s.DB().ExecContext(ctx,
		`INSERT INTO files (workspace_id, source_id, path, title, frontmatter, body, is_ai_context, mtime)
		 VALUES ('ws', 'local', 'guide.md', 'Guide', '{}', 'hello world', 0, 0)`)
	if err != nil {
		t.Fatalf("seed insert: %v", err)
	}

	body, ok, err := s.GetFileBody(ctx, "ws", "local", "guide.md")
	if err != nil {
		t.Fatalf("GetFileBody: %v", err)
	}
	if !ok || body != "hello world" {
		t.Fatalf("GetFileBody = (%q, %v), want (%q, true)", body, ok, "hello world")
	}

	_, ok, err = s.GetFileBody(ctx, "ws", "local", "nope.md")
	if err != nil {
		t.Fatalf("GetFileBody (missing): %v", err)
	}
	if ok {
		t.Fatal("expected ok=false for a path that was never indexed")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/store/... -run TestStore_GetFileBody`
Expected: FAIL — `s.GetFileBody undefined`.

- [ ] **Step 3: Write the implementation**

Add to `internal/store/store.go`, after the existing `Close` method:

```go
// GetFileBody returns the currently indexed body for a file, or ok=false if
// no such row exists (never indexed, or already removed).
func (s *Store) GetFileBody(ctx context.Context, workspaceID, sourceID, path string) (body string, ok bool, err error) {
	err = s.db.QueryRowContext(ctx,
		`SELECT body FROM files WHERE workspace_id=? AND source_id=? AND path=?`,
		workspaceID, sourceID, path,
	).Scan(&body)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return body, true, nil
}
```

`database/sql` is already imported in `store.go` (for `*sql.DB`), so no import changes are needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/store/... -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
gofmt -l internal/store
git add internal/store/store.go internal/store/store_test.go
git commit -m "feat: add Store.GetFileBody to read a file's currently indexed content"
```

---

## Task 4: Wire `Events`/`Diffs` into `App`

**Files:**
- Modify: `internal/app/app.go`
- Modify: `internal/app/app_test.go`

**Interfaces:**
- Consumes: `livesync.NewHub() *livesync.Hub`, `livesync.NewDiffCache(cap int) *livesync.DiffCache` (Tasks 1–2).
- Produces: `App.Events *livesync.Hub`, `App.Diffs *livesync.DiffCache`, both non-nil after `app.New()`.

- [ ] **Step 1: Write the failing test**

Add to `internal/app/app_test.go`:

```go
func TestApp_New_WiresLivesyncHubAndDiffCache(t *testing.T) {
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Server:     config.ServerConfig{Addr: ":0"},
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
	}
	a, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer a.Close()

	if a.Events == nil {
		t.Fatal("expected App.Events to be initialized")
	}
	if a.Diffs == nil {
		t.Fatal("expected App.Diffs to be initialized")
	}

	// Roundtrip: Diffs should behave like a working DiffCache.
	a.Diffs.Record("ws", "local", "x.md", "old", "new")
	old, new_, available := a.Diffs.Consume("ws", "local", "x.md")
	if !available || old != "old" || new_ != "new" {
		t.Fatalf("Diffs roundtrip = (%q, %q, %v)", old, new_, available)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/app/... -run TestApp_New_WiresLivesyncHubAndDiffCache`
Expected: FAIL — compile error, `a.Events undefined`.

- [ ] **Step 3: Write the implementation**

In `internal/app/app.go`, add the import and struct fields, and initialize them in `New`:

```go
	"github.com/tuannm99/dmox/internal/index"
	"github.com/tuannm99/dmox/internal/livesync"
	"github.com/tuannm99/dmox/internal/render"
```

```go
type App struct {
	Cfg        *config.Config
	Store      *store.Store
	Indexer    *index.Indexer
	Search     *search.Service
	Git        *gitsvc.Service
	PlantUML   *render.PlantUMLRenderer
	Events     *livesync.Hub
	Diffs      *livesync.DiffCache
	Workspaces map[string]*Workspace
}
```

In `New`, add to the `a := &App{...}` literal (after `PlantUML:`):

```go
		PlantUML:   render.NewPlantUMLRenderer(cfg.Render.PlantUML.JarPath, filepath.Join(cfg.DataDir, "plantuml-cache")),
		Events:     livesync.NewHub(),
		Diffs:      livesync.NewDiffCache(200),
		Workspaces: map[string]*Workspace{},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/app/... -v`
Expected: PASS (all `app` package tests, including the new one).

- [ ] **Step 5: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
gofmt -l internal/app
git add internal/app/app.go internal/app/app_test.go
git commit -m "feat: wire livesync Hub and DiffCache into App"
```

---

## Task 5: Publish events and record diffs from `watchAndReindex`

**Files:**
- Modify: `cmd/dmox/serve.go`
- Modify: `cmd/dmox/serve_test.go`

**Interfaces:**
- Consumes: `App.Store.GetFileBody` (Task 3), `App.Events.Publish` / `App.Diffs.Record` (Tasks 1, 2, 4), existing `source.ChangeEvent{Path string, Op ChangeOp}` and `ChangeOp` constants (`internal/source/source.go`).
- Produces: no new exported symbols; `watchAndReindex`'s existing signature is unchanged, so no caller elsewhere needs updating.

- [ ] **Step 1: Write the failing test**

Add to `cmd/dmox/serve_test.go`:

```go
func TestWatchAndReindex_PublishesEventAndRecordsDiff(t *testing.T) {
	docsDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(docsDir, "guide.md"), []byte("# Guide\nv1"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{{ID: "local", Type: "local", Path: docsDir}}},
		},
	}
	a, err := app.New(cfg)
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	defer a.Close()

	src := a.Workspaces["ws"].Sources["local"]
	ctx := context.Background()
	if err := a.Indexer.IndexFile(ctx, "ws", src, "guide.md"); err != nil {
		t.Fatalf("seed IndexFile: %v", err)
	}

	sub, cancel := a.Events.Subscribe("ws")
	defer cancel()

	if err := os.WriteFile(filepath.Join(docsDir, "guide.md"), []byte("# Guide\nv2"), 0o644); err != nil {
		t.Fatal(err)
	}
	events := make(chan source.ChangeEvent, 1)
	events <- source.ChangeEvent{Path: "guide.md", Op: source.ChangeOpModify}
	close(events)

	watchAndReindex(ctx, a, "ws", src, events)

	select {
	case ev := <-sub:
		if ev.SourceID != "local" || ev.Path != "guide.md" || ev.Op != "modify" {
			t.Fatalf("published event = %+v", ev)
		}
	default:
		t.Fatal("expected an event to have been published")
	}

	old, new_, available := a.Diffs.Consume("ws", "local", "guide.md")
	if !available {
		t.Fatal("expected a diff entry to have been recorded")
	}
	if old != "Guide\nv1" || new_ != "Guide\nv2" {
		t.Fatalf("diff = (old=%q, new=%q)", old, new_)
	}
}

func TestWatchAndReindex_DeleteDoesNotRecordDiff(t *testing.T) {
	docsDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(docsDir, "guide.md"), []byte("# Guide\nv1"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{{ID: "local", Type: "local", Path: docsDir}}},
		},
	}
	a, err := app.New(cfg)
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	defer a.Close()

	src := a.Workspaces["ws"].Sources["local"]
	ctx := context.Background()
	if err := a.Indexer.IndexFile(ctx, "ws", src, "guide.md"); err != nil {
		t.Fatalf("seed IndexFile: %v", err)
	}
	if err := os.Remove(filepath.Join(docsDir, "guide.md")); err != nil {
		t.Fatal(err)
	}

	events := make(chan source.ChangeEvent, 1)
	events <- source.ChangeEvent{Path: "guide.md", Op: source.ChangeOpDelete}
	close(events)

	watchAndReindex(ctx, a, "ws", src, events)

	if _, _, available := a.Diffs.Consume("ws", "local", "guide.md"); available {
		t.Fatal("expected no diff entry for a delete")
	}
}
```

Note: `Parse()` (`internal/index/frontmatter.go`) strips a leading `# Heading` line into `doc.Title` and leaves the rest as `doc.Body` — that's why the seeded content `"# Guide\nv1"` is indexed as body `"Guide\nv1"` in the assertions above (matching the existing behavior already exercised in `internal/index/indexer_test.go`'s `TestParse_FrontmatterAndFallbackTitle`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./cmd/dmox/... -run TestWatchAndReindex`
Expected: FAIL — `a.Events undefined` becomes defined by Task 4, so this should actually compile; the failure here is the new assertions finding no published event / no diff recorded, since `watchAndReindex` doesn't do that yet.

- [ ] **Step 3: Write the implementation**

Replace `watchAndReindex` in `cmd/dmox/serve.go`:

```go
func watchAndReindex(ctx context.Context, a *app.App, wsID string, src source.Source, events <-chan source.ChangeEvent) {
	for ev := range events {
		oldBody, hadOld, err := a.Store.GetFileBody(ctx, wsID, src.ID(), ev.Path)
		if err != nil {
			log.Printf("watch %s/%s/%s: read previous content failed: %v", wsID, src.ID(), ev.Path, err)
		}

		if err := a.Indexer.IndexFile(ctx, wsID, src, ev.Path); err != nil {
			log.Printf("reindex %s/%s/%s failed: %v", wsID, src.ID(), ev.Path, err)
			continue
		}

		if ev.Op != source.ChangeOpDelete {
			if newBody, ok, err := a.Store.GetFileBody(ctx, wsID, src.ID(), ev.Path); err == nil && ok {
				base := ""
				if hadOld {
					base = oldBody
				}
				a.Diffs.Record(wsID, src.ID(), ev.Path, base, newBody)
			}
		}

		a.Events.Publish(wsID, livesync.Event{SourceID: src.ID(), Path: ev.Path, Op: changeOpString(ev.Op)})
	}
}

func changeOpString(op source.ChangeOp) string {
	switch op {
	case source.ChangeOpCreate:
		return "create"
	case source.ChangeOpDelete:
		return "delete"
	default:
		return "modify"
	}
}
```

Add the import in `cmd/dmox/serve.go`:

```go
	"github.com/tuannm99/dmox/internal/livesync"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./cmd/dmox/... -v`
Expected: PASS (existing `TestWatchAndReindex_ProcessesEventsThenExitsOnChannelClose` plus the two new tests).

- [ ] **Step 5: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
gofmt -l cmd/dmox
git add cmd/dmox/serve.go cmd/dmox/serve_test.go
git commit -m "feat: publish change events and record diffs from the fs watcher"
```

---

## Task 6: SSE and diff HTTP endpoints

**Files:**
- Create: `internal/api/livesync_handlers.go`
- Create: `internal/api/livesync_handlers_test.go`
- Modify: `internal/api/server.go`

**Interfaces:**
- Consumes: `App.Events.Subscribe`/`App.Diffs.Consume` (Tasks 1, 2, 4), `App.Workspace(id)` (existing), `findLocalSource(ws *app.Workspace, sourceID string) *source.LocalSource` (existing, `internal/api/terminal_handlers.go`).
- Produces: `GET /api/workspaces/:id/events` (SSE), `GET /api/workspaces/:id/file/diff?path=...&source=...` (JSON `{available, old?, new?}`).

- [ ] **Step 1: Write the failing tests**

```go
// internal/api/livesync_handlers_test.go
package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tuannm99/dmox/internal/livesync"
)

func TestAPI_WorkspaceEvents_StreamsPublishedChange(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/workspaces/ws/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /events: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	lines := make(chan string, 8)
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
	}()

	a.Events.Publish("ws", livesync.Event{SourceID: "local", Path: "guide.md", Op: "modify"})

	deadline := time.After(3 * time.Second)
	for {
		select {
		case line := <-lines:
			if strings.Contains(line, `"path":"guide.md"`) && strings.Contains(line, `"op":"modify"`) {
				return
			}
		case <-deadline:
			t.Fatal("timed out waiting for the SSE change event")
		}
	}
}

func TestAPI_WorkspaceEvents_UnknownWorkspace(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/nope/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestAPI_FileDiff_AvailableAfterRecord(t *testing.T) {
	a := newTestApp(t)
	a.Diffs.Record("ws", "local", "guide.md", "old body", "new body")
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/file/diff?path=guide.md&source=local")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out["available"] != true {
		t.Fatalf("available = %v, want true", out["available"])
	}
	if out["old"] != "old body" || out["new"] != "new body" {
		t.Fatalf("diff = %+v", out)
	}
}

func TestAPI_FileDiff_UnavailableWhenNeverRecorded(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/file/diff?path=guide.md&source=local")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out["available"] != false {
		t.Fatalf("available = %v, want false", out["available"])
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/api/... -run 'TestAPI_WorkspaceEvents|TestAPI_FileDiff'`
Expected: FAIL — 404s / compile error, routes and handlers don't exist yet.

- [ ] **Step 3: Write the implementation**

```go
// internal/api/livesync_handlers.go
package api

import (
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/app"
)

// handleWorkspaceEvents streams livesync.Hub events for a workspace as
// Server-Sent Events. Headers are flushed immediately on connect (before
// any event exists to write) so both callers relying on prompt connection
// establishment behave correctly: the browser EventSource's onopen fires
// right away (the frontend treats onopen as its "just (re)connected, maybe
// resync" signal), and an httptest client's Do() doesn't block waiting for
// the first byte.
func handleWorkspaceEvents(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		wsID := c.Param("id")
		if _, ok := a.Workspace(wsID); !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}

		events, cancel := a.Events.Subscribe(wsID)
		defer cancel()

		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Writer.WriteHeaderNow()
		c.Writer.Flush()

		c.Stream(func(w io.Writer) bool {
			select {
			case ev, ok := <-events:
				if !ok {
					return false
				}
				c.SSEvent("change", ev)
				return true
			case <-c.Request.Context().Done():
				return false
			}
		})
	}
}

// handleFileDiff serves and consumes a pending DiffCache entry. ?source= is
// optional and defaults to the workspace's first local source, matching how
// handleTerminalWS resolves a source — diffs only ever apply to
// locally-watched files.
func handleFileDiff(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		wsID := c.Param("id")
		ws, ok := a.Workspace(wsID)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}

		sourceID := c.Query("source")
		if sourceID == "" {
			if ls := findLocalSource(ws, ""); ls != nil {
				sourceID = ls.ID()
			}
		}
		path := c.Query("path")

		old, new_, available := a.Diffs.Consume(wsID, sourceID, path)
		if !available {
			c.JSON(http.StatusOK, gin.H{"available": false})
			return
		}
		c.JSON(http.StatusOK, gin.H{"available": true, "old": old, "new": new_})
	}
}
```

Wire the routes in `internal/api/server.go`, in `NewRouter`, after the existing `g.GET("/workspaces/:id/git/blame", ...)` line:

```go
	g.GET("/workspaces/:id/git/blame", handleGitBlame(a))
	g.GET("/workspaces/:id/events", handleWorkspaceEvents(a))
	g.GET("/workspaces/:id/file/diff", handleFileDiff(a))
	g.POST("/sources/:id/pull", handleSourcePull(a))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/api/... -v`
Expected: PASS (all `api` package tests, including the 4 new ones).

- [ ] **Step 5: Run the full backend suite**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
gofmt -l internal/api
git add internal/api/livesync_handlers.go internal/api/livesync_handlers_test.go internal/api/server.go
git commit -m "feat: add SSE change stream and file-diff API endpoints"
```

---

## Task 7: `DataSource.subscribeToChanges` / `getFileDiff`

**Files:**
- Modify: `web/src/datasource/types.ts`
- Modify: `web/src/datasource/liveDataSource.ts`
- Modify: `web/src/datasource/staticDataSource.ts`
- Modify: `web/src/datasource/liveDataSource.test.ts`
- Modify: `web/src/datasource/staticDataSource.test.ts`

**Interfaces:**
- Produces: `export interface ChangeEvent { sourceId: string; path: string; op: 'create' | 'modify' | 'delete' }`, `export interface FileDiff { available: boolean; old?: string; new?: string }`, `DataSource.subscribeToChanges(workspaceId: string, onEvent: (ev: ChangeEvent) => void, onResync: () => void): () => void`, `DataSource.getFileDiff(workspaceId: string, sourceId: string, path: string): Promise<FileDiff>`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/datasource/liveDataSource.test.ts`:

```ts
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
```

Append to `web/src/datasource/staticDataSource.test.ts`:

```ts
describe('createStaticDataSource subscribeToChanges / getFileDiff', () => {
  it('subscribeToChanges is a no-op that never calls onEvent/onResync', () => {
    const ds = createStaticDataSource('/base/');
    const onEvent = vi.fn();
    const onResync = vi.fn();
    const cleanup = ds.subscribeToChanges('ws', onEvent, onResync);
    cleanup();
    expect(onEvent).not.toHaveBeenCalled();
    expect(onResync).not.toHaveBeenCalled();
  });

  it('getFileDiff always resolves unavailable', async () => {
    const ds = createStaticDataSource('/base/');
    await expect(ds.getFileDiff('ws', 'local', 'a.md')).resolves.toEqual({ available: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/datasource/liveDataSource.test.ts src/datasource/staticDataSource.test.ts`
Expected: FAIL — `ds.subscribeToChanges is not a function` / `ds.getFileDiff is not a function`, and TypeScript errors on the `DataSource` type not having these members once `types.ts` is edited but the implementations aren't yet (do `types.ts` first if your editor type-checks live — the test run itself is JS-level and will just fail at the missing-function assertions).

- [ ] **Step 3: Write the implementation**

In `web/src/datasource/types.ts`, add after the existing `GitBlameResult` interface:

```ts
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
```

Add to the `DataSource` interface, after `getGitBlame`:

```ts
  subscribeToChanges(workspaceId: string, onEvent: (ev: ChangeEvent) => void, onResync: () => void): () => void;
  getFileDiff(workspaceId: string, sourceId: string, path: string): Promise<FileDiff>;
```

In `web/src/datasource/liveDataSource.ts`, update the import and add both methods to the returned object:

```ts
import type {
  DataSource, TreeNode, FileView, SearchResult, AIContextEntry, Workspace,
  GitHistoryResult, GitBlameResult, ChangeEvent, FileDiff,
} from './types';
```

```ts
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
```

In `web/src/datasource/staticDataSource.ts`, update the import and add both methods:

```ts
import type {
  DataSource, TreeNode, FileView, SearchResult, AIContextEntry, Workspace,
  GitHistoryResult, GitBlameResult, FileDiff,
} from './types';
```

```ts
    getGitBlame: async (_workspaceId, path) => {
      const all = await getJSON<Record<string, GitBlameResult>>(`${root}/data/git-history.json`);
      return all[`${path}#blame`] ?? { applicable: false, lines: [] };
    },
    // A static export is a frozen snapshot: it never changes live, and has
    // no server to stream events from, so this is a correct no-op rather
    // than a stub.
    subscribeToChanges: () => () => {},
    getFileDiff: async (): Promise<FileDiff> => ({ available: false }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/datasource/liveDataSource.test.ts src/datasource/staticDataSource.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
git add web/src/datasource/types.ts web/src/datasource/liveDataSource.ts web/src/datasource/staticDataSource.ts web/src/datasource/liveDataSource.test.ts web/src/datasource/staticDataSource.test.ts
git commit -m "feat: add subscribeToChanges and getFileDiff to DataSource"
```

---

## Task 8: `ToastStack` component

**Files:**
- Create: `web/src/components/ToastStack.tsx`
- Create: `web/src/components/ToastStack.test.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `ChangeEvent['op']` type (Task 7).
- Produces: `export interface ToastItem { id: string; sourceId: string; path: string; op: ChangeEvent['op'] }`, `export function ToastStack({ items, onDismiss, onViewDiff }): JSX.Element | null`.

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/ToastStack.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastStack, type ToastItem } from './ToastStack';

describe('ToastStack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there are no items', () => {
    const { container } = render(<ToastStack items={[]} onDismiss={vi.fn()} onViewDiff={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a toast with the path and a human-readable op label', () => {
    const items: ToastItem[] = [{ id: '1', sourceId: 'local', path: 'guide.md', op: 'modify' }];
    render(<ToastStack items={items} onDismiss={vi.fn()} onViewDiff={vi.fn()} />);
    expect(screen.getByText(/guide\.md/)).toBeInTheDocument();
    expect(screen.getByText(/modified/)).toBeInTheDocument();
  });

  it('shows a "View diff" action for modify/create but not delete', () => {
    const items: ToastItem[] = [
      { id: '1', sourceId: 'local', path: 'a.md', op: 'modify' },
      { id: '2', sourceId: 'local', path: 'b.md', op: 'delete' },
    ];
    render(<ToastStack items={items} onDismiss={vi.fn()} onViewDiff={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /view diff/i })).toHaveLength(1);
  });

  it('calls onViewDiff with the clicked item', () => {
    const items: ToastItem[] = [{ id: '1', sourceId: 'local', path: 'a.md', op: 'create' }];
    const onViewDiff = vi.fn();
    render(<ToastStack items={items} onDismiss={vi.fn()} onViewDiff={onViewDiff} />);
    fireEvent.click(screen.getByRole('button', { name: /view diff/i }));
    expect(onViewDiff).toHaveBeenCalledWith(items[0]);
  });

  it('calls onDismiss when the dismiss button is clicked', () => {
    const items: ToastItem[] = [{ id: '1', sourceId: 'local', path: 'a.md', op: 'modify' }];
    const onDismiss = vi.fn();
    render(<ToastStack items={items} onDismiss={onDismiss} onViewDiff={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith('1');
  });

  it('auto-dismisses after 4 seconds', () => {
    const items: ToastItem[] = [{ id: '1', sourceId: 'local', path: 'a.md', op: 'modify' }];
    const onDismiss = vi.fn();
    render(<ToastStack items={items} onDismiss={onDismiss} onViewDiff={vi.fn()} />);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    expect(onDismiss).toHaveBeenCalledWith('1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/ToastStack.test.tsx`
Expected: FAIL — module `./ToastStack` doesn't exist.

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/components/ToastStack.tsx
import { useEffect } from 'react';
import type { ChangeEvent } from '../datasource/types';

export interface ToastItem {
  id: string;
  sourceId: string;
  path: string;
  op: ChangeEvent['op'];
}

const AUTO_DISMISS_MS = 4000;

function opLabel(op: ChangeEvent['op']): string {
  switch (op) {
    case 'create':
      return 'created';
    case 'delete':
      return 'deleted';
    default:
      return 'modified';
  }
}

export function ToastStack({
  items,
  onDismiss,
  onViewDiff,
}: {
  items: ToastItem[];
  onDismiss: (id: string) => void;
  onViewDiff: (item: ToastItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="toast-stack">
      {items.map((item) => (
        <ToastItemView key={item.id} item={item} onDismiss={onDismiss} onViewDiff={onViewDiff} />
      ))}
    </div>
  );
}

function ToastItemView({
  item,
  onDismiss,
  onViewDiff,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
  onViewDiff: (item: ToastItem) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  return (
    <div className="toast" role="status">
      <span className="toast-text">
        {item.path} {opLabel(item.op)}
      </span>
      {item.op !== 'delete' && (
        <button type="button" className="toast-action" onClick={() => onViewDiff(item)}>
          View diff
        </button>
      )}
      <button type="button" className="toast-dismiss" aria-label="Dismiss" onClick={() => onDismiss(item.id)}>
        ×
      </button>
    </div>
  );
}
```

Append to `web/src/styles.css`:

```css
.toast-stack {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 50;
}

.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #222;
  color: #fff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.toast-text {
  flex: 1;
}

.toast-action {
  background: none;
  border: 1px solid #666;
  color: inherit;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
}

.toast-dismiss {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/ToastStack.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
git add web/src/components/ToastStack.tsx web/src/components/ToastStack.test.tsx web/src/styles.css
git commit -m "feat: add ToastStack component for change notifications"
```

---

## Task 9: `DiffModal` component

**Files:**
- Create: `web/src/components/DiffModal.tsx`
- Create: `web/src/components/DiffModal.test.tsx`
- Modify: `web/src/styles.css`
- Modify: `web/package.json` (new dependency `diff`)

**Interfaces:**
- Consumes: `useDataSource()` / `DataSource.getFileDiff` (Task 7).
- Produces: `export function DiffModal({ workspaceId, sourceId, path, onClose }): JSX.Element`.

- [ ] **Step 1: Install the `diff` dependency**

Run: `cd web && npm install diff`
Expected: `web/package.json` and `web/package-lock.json` updated with `diff` under `dependencies`. The `diff` package ships its own TypeScript types, so no `@types/diff` is needed.

- [ ] **Step 2: Write the failing tests**

```tsx
// web/src/components/DiffModal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DiffModal } from './DiffModal';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

describe('DiffModal', () => {
  it('renders removed and added lines from the fetched diff', async () => {
    (globalThis as any).__testDataSource = {
      getFileDiff: vi.fn().mockResolvedValue({ available: true, old: 'line1\nline2', new: 'line1\nline2 changed' }),
    };
    render(<DiffModal workspaceId="ws" sourceId="local" path="guide.md" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/- line2/)).toBeInTheDocument());
    expect(screen.getByText(/\+ line2 changed/)).toBeInTheDocument();
  });

  it('shows a message when no previous version is available', async () => {
    (globalThis as any).__testDataSource = {
      getFileDiff: vi.fn().mockResolvedValue({ available: false }),
    };
    render(<DiffModal workspaceId="ws" sourceId="local" path="guide.md" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no previous version/i)).toBeInTheDocument());
  });

  it('calls onClose when the close button is clicked', async () => {
    (globalThis as any).__testDataSource = {
      getFileDiff: vi.fn().mockResolvedValue({ available: false }),
    };
    const onClose = vi.fn();
    render(<DiffModal workspaceId="ws" sourceId="local" path="guide.md" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText(/no previous version/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /close diff/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/DiffModal.test.tsx`
Expected: FAIL — module `./DiffModal` doesn't exist.

- [ ] **Step 4: Write the implementation**

```tsx
// web/src/components/DiffModal.tsx
import { useEffect, useState } from 'react';
import { diffLines } from 'diff';
import { useDataSource } from '../datasource/context';
import type { FileDiff } from '../datasource/types';

function splitDiffLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function DiffModal({
  workspaceId,
  sourceId,
  path,
  onClose,
}: {
  workspaceId: string;
  sourceId: string;
  path: string;
  onClose: () => void;
}) {
  const ds = useDataSource();
  const [diff, setDiff] = useState<FileDiff | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    ds.getFileDiff(workspaceId, sourceId, path).then((d) => {
      if (!cancelled) setDiff(d);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, workspaceId, sourceId, path]);

  return (
    <div className="diff-modal-overlay" onClick={onClose}>
      <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-modal-header">
          <span>{path}</span>
          <button type="button" onClick={onClose} aria-label="Close diff">
            ×
          </button>
        </div>
        {diff === null && <div className="loading">Loading…</div>}
        {diff !== null && !diff.available && <p className="diff-unavailable">No previous version to compare.</p>}
        {diff !== null && diff.available && (
          <pre className="diff-body">
            {diffLines(diff.old ?? '', diff.new ?? '').map((part, i) => {
              const cls = part.added ? 'diff-line-added' : part.removed ? 'diff-line-removed' : 'diff-line-context';
              const prefix = part.added ? '+' : part.removed ? '-' : ' ';
              return (
                <div key={i} className={cls}>
                  {splitDiffLines(part.value).map((line, j) => (
                    <div key={j}>
                      {prefix} {line}
                    </div>
                  ))}
                </div>
              );
            })}
          </pre>
        )}
      </div>
    </div>
  );
}
```

Append to `web/src/styles.css`:

```css
.diff-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}

.diff-modal {
  background: #1e1e1e;
  color: #ddd;
  width: min(800px, 90vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border-radius: 6px;
  overflow: hidden;
}

.diff-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #333;
  font-family: monospace;
}

.diff-modal-header button {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 1.1rem;
}

.diff-body {
  overflow: auto;
  padding: 8px 0;
  margin: 0;
  font-size: 0.85rem;
}

.diff-line-added {
  background: rgba(46, 160, 67, 0.2);
  color: #7ee787;
}

.diff-line-removed {
  background: rgba(248, 81, 73, 0.2);
  color: #ffa198;
}

.diff-line-context {
  color: #999;
}

.diff-unavailable {
  padding: 12px;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/DiffModal.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
git add web/package.json web/package-lock.json web/src/components/DiffModal.tsx web/src/components/DiffModal.test.tsx web/src/styles.css
git commit -m "feat: add DiffModal component for viewing on-disk change diffs"
```

---

## Task 10: Wire live-reload into `WorkspaceLayout`

**Files:**
- Modify: `web/src/routes/WorkspaceLayout.tsx`
- Modify: `web/src/routes/WorkspaceLayout.test.tsx`

**Interfaces:**
- Consumes: `DataSource.subscribeToChanges` (Task 7), `ToastStack`/`ToastItem` (Task 8), `DiffModal` (Task 9).
- Produces: extended `WorkspaceOutletContext` — `{ tree, scrollToTop, resetScroll, contentRef: React.RefObject<HTMLElement>, fileChangeEvent: ChangeEvent | null }` — consumed by Task 11.

- [ ] **Step 1: Write the failing tests**

The existing `vi.mock('../datasource/context', ...)` in `WorkspaceLayout.test.tsx` returns whatever `ds` object each test provides, and most existing tests' `ds` objects don't define `subscribeToChanges`. Since `WorkspaceLayout` will now call it unconditionally on mount, give the mock a harmless default first, then add new behavioral tests. Update the mock at the top of `web/src/routes/WorkspaceLayout.test.tsx`:

```ts
vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return {
    ...actual,
    useDataSource: () => ({ subscribeToChanges: () => () => {}, ...(globalThis as any).__testDataSource }),
  };
});
```

(This replaces the existing `useDataSource: () => (globalThis as any).__testDataSource` line — every existing test keeps working unchanged, since spreading `__testDataSource` last still lets a test override `subscribeToChanges` when it wants to.)

Add new tests at the end of the `describe('WorkspaceLayout', ...)` block:

```tsx
  it('refetches the tree when a change event arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let capturedOnEvent: ((ev: any) => void) | undefined;
    const getTree = vi
      .fn()
      .mockResolvedValueOnce({ name: 'WS', path: '', is_dir: true, children: [] })
      .mockResolvedValueOnce({ name: 'WS', path: '', is_dir: true, children: [{ name: 'new.md', path: 'local/new.md', is_dir: false }] });
    const ds = {
      getTree,
      subscribeToChanges: (_id: string, onEvent: (ev: any) => void) => {
        capturedOnEvent = onEvent;
        return () => {};
      },
    };
    renderWithDataSource(ds);
    await screen.findByText('welcome');

    capturedOnEvent?.({ sourceId: 'local', path: 'new.md', op: 'create' });
    await vi.advanceTimersByTimeAsync(200);

    await waitFor(() => expect(getTree).toHaveBeenCalledTimes(2));
    vi.useRealTimers();
  });

  it('shows a toast for a change event, with a working View diff / dismiss flow', async () => {
    let capturedOnEvent: ((ev: any) => void) | undefined;
    const ds = {
      getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }),
      subscribeToChanges: (_id: string, onEvent: (ev: any) => void) => {
        capturedOnEvent = onEvent;
        return () => {};
      },
      getFileDiff: vi.fn().mockResolvedValue({ available: false }),
    };
    renderWithDataSource(ds);
    await screen.findByText('welcome');

    capturedOnEvent?.({ sourceId: 'local', path: 'guide.md', op: 'modify' });
    expect(await screen.findByText(/guide\.md/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /view diff/i }));
    await waitFor(() => expect(ds.getFileDiff).toHaveBeenCalledWith('ws', 'local', 'guide.md'));
    expect(await screen.findByText(/no previous version/i)).toBeInTheDocument();
  });

  it('calls the unsubscribe function returned by subscribeToChanges on unmount', async () => {
    const unsubscribe = vi.fn();
    const ds = {
      getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }),
      subscribeToChanges: vi.fn(() => unsubscribe),
    };
    const { unmount } = renderWithDataSource(ds);
    await screen.findByText('welcome');
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/routes/WorkspaceLayout.test.tsx`
Expected: FAIL — no toast appears, `getTree` isn't called a second time, `subscribeToChanges`'s returned cleanup is never invoked (`WorkspaceLayout` doesn't call it at all yet).

- [ ] **Step 3: Write the implementation**

Update the type-only import and add new imports in `web/src/routes/WorkspaceLayout.tsx`:

```ts
import type { TreeNode, ChangeEvent } from '../datasource/types';
import { ToastStack, type ToastItem } from '../components/ToastStack';
import { DiffModal } from '../components/DiffModal';
```

Extend `WorkspaceOutletContext`:

```ts
export interface WorkspaceOutletContext {
  tree: TreeNode;
  scrollToTop: () => void;
  resetScroll: () => void;
  contentRef: React.RefObject<HTMLElement>;
  fileChangeEvent: ChangeEvent | null;
}
```

Add new state and refs inside `WorkspaceLayout`, alongside the existing `useState`/`useRef` declarations:

```ts
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [diffTarget, setDiffTarget] = useState<{ sourceId: string; path: string } | null>(null);
  const [fileChangeEvent, setFileChangeEvent] = useState<ChangeEvent | null>(null);
  const currentPathRef = useRef<string | undefined>(currentPath);
  const treeRefetchTimer = useRef<ReturnType<typeof setTimeout>>();
  const toastIdRef = useRef(0);
```

Keep `currentPathRef` current (add near the other small effects):

```ts
  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);
```

Add the subscription effect (a new, separate `useEffect` — do not merge into the existing tree-fetch effect, since that one intentionally re-runs on every `workspaceId` change and resets `tree`/`error`/panel state; this one manages a long-lived subscription that should not tear down and reopen on unrelated state changes):

```ts
  useEffect(() => {
    function scheduleTreeRefetch() {
      clearTimeout(treeRefetchTimer.current);
      treeRefetchTimer.current = setTimeout(() => {
        ds.getTree(workspaceId).then(setTree, (e) => setError(String(e)));
      }, 200);
    }

    function handleEvent(ev: ChangeEvent) {
      scheduleTreeRefetch();
      toastIdRef.current += 1;
      setToasts((prev) => [...prev, { id: String(toastIdRef.current), sourceId: ev.sourceId, path: ev.path, op: ev.op }]);
      if (currentPathRef.current === `${ev.sourceId}/${ev.path}`) {
        setFileChangeEvent(ev);
      }
    }

    function handleResync() {
      ds.getTree(workspaceId).then(setTree, (e) => setError(String(e)));
      const current = currentPathRef.current;
      if (!current) return;
      const slash = current.indexOf('/');
      if (slash > 0) {
        setFileChangeEvent({ sourceId: current.slice(0, slash), path: current.slice(slash + 1), op: 'modify' });
      }
    }

    return ds.subscribeToChanges(workspaceId, handleEvent, handleResync);
  }, [ds, workspaceId]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const viewDiff = useCallback((item: ToastItem) => {
    setDiffTarget({ sourceId: item.sourceId, path: item.path });
  }, []);
```

Update the `Outlet` context and add the new elements in the JSX (`Outlet` line and the closing of `.workspace-layout`):

```tsx
          <Outlet context={{ tree, scrollToTop, resetScroll, contentRef, fileChangeEvent } satisfies WorkspaceOutletContext} />
```

```tsx
        {showScrollTop && (
          <button type="button" className="scroll-to-top" onClick={scrollToTop}>
            ↑ Top
          </button>
        )}
        <ToastStack items={toasts} onDismiss={dismissToast} onViewDiff={viewDiff} />
        {diffTarget && (
          <DiffModal
            workspaceId={workspaceId}
            sourceId={diffTarget.sourceId}
            path={diffTarget.path}
            onClose={() => setDiffTarget(null)}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/routes/WorkspaceLayout.test.tsx`
Expected: PASS (all existing tests plus the 3 new ones).

- [ ] **Step 5: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
git add web/src/routes/WorkspaceLayout.tsx web/src/routes/WorkspaceLayout.test.tsx
git commit -m "feat: wire live-reload events, toasts, and diff modal into WorkspaceLayout"
```

---

## Task 11: `FileViewerPage` reacts to `fileChangeEvent`

**Files:**
- Modify: `web/src/routes/FileViewerPage.tsx`
- Modify: `web/src/routes/FileViewerPage.test.tsx`

**Interfaces:**
- Consumes: `WorkspaceOutletContext.contentRef` / `WorkspaceOutletContext.fileChangeEvent` (Task 10).

- [ ] **Step 1: Write the failing tests**

Add to `web/src/routes/FileViewerPage.test.tsx` (needs `useRef`, `useState` imports added to the existing `import { ... } from 'react'`... note the test file doesn't currently import from `'react'` directly, so add `import { useRef, useState } from 'react';` at the top):

```tsx
  it('refetches and preserves scroll position when a matching modify event arrives via outlet context', async () => {
    (globalThis as any).__testDataSource = {
      getFile: vi
        .fn()
        .mockResolvedValueOnce({ path: 'local/b.md', title: 'B v1', frontmatter: {}, body: 'body v1', headings: [], is_ai_context: false })
        .mockResolvedValueOnce({ path: 'local/b.md', title: 'B v2', frontmatter: {}, body: 'body v2', headings: [], is_ai_context: false }),
    };

    function ParentWithContext() {
      const [fileChangeEvent, setFileChangeEvent] = useState<{ sourceId: string; path: string; op: 'modify' } | null>(null);
      const contentRef = useRef<HTMLElement>(null);
      return (
        <div>
          <button onClick={() => setFileChangeEvent({ sourceId: 'local', path: 'b.md', op: 'modify' })}>simulate modify</button>
          <Outlet context={{ tree: undefined, scrollToTop: vi.fn(), resetScroll: vi.fn(), contentRef, fileChangeEvent }} />
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={['/w/ws/doc/local/b.md']}>
        <Routes>
          <Route element={<ParentWithContext />}>
            <Route path="/w/:workspaceId/doc/*" element={<FileViewerPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'B v1' })).toBeInTheDocument());

    fireEvent.click(screen.getByText('simulate modify'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'B v2' })).toBeInTheDocument());
  });

  it('shows a deleted banner when a matching delete event arrives via outlet context', async () => {
    (globalThis as any).__testDataSource = {
      getFile: vi.fn().mockResolvedValue({ path: 'local/b.md', title: 'B', frontmatter: {}, body: 'body', headings: [], is_ai_context: false }),
    };

    function ParentWithContext() {
      const [fileChangeEvent, setFileChangeEvent] = useState<{ sourceId: string; path: string; op: 'delete' } | null>(null);
      const contentRef = useRef<HTMLElement>(null);
      return (
        <div>
          <button onClick={() => setFileChangeEvent({ sourceId: 'local', path: 'b.md', op: 'delete' })}>simulate delete</button>
          <Outlet context={{ tree: undefined, scrollToTop: vi.fn(), resetScroll: vi.fn(), contentRef, fileChangeEvent }} />
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={['/w/ws/doc/local/b.md']}>
        <Routes>
          <Route element={<ParentWithContext />}>
            <Route path="/w/:workspaceId/doc/*" element={<FileViewerPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'B' })).toBeInTheDocument());

    fireEvent.click(screen.getByText('simulate delete'));

    await waitFor(() => expect(screen.getByText(/this file was deleted/i)).toBeInTheDocument());
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/routes/FileViewerPage.test.tsx`
Expected: FAIL — heading stays at "B v1" (no refetch happens), no "this file was deleted" text ever appears.

- [ ] **Step 3: Write the implementation**

In `web/src/routes/FileViewerPage.tsx`, add `deleted` state and a new effect reacting to `outletContext.fileChangeEvent`:

```tsx
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    setDeleted(false);
  }, [wildcardPath]);

  useEffect(() => {
    const ev = outletContext?.fileChangeEvent;
    if (!ev) return;
    if (ev.op === 'delete') {
      setDeleted(true);
      return;
    }
    const scrollEl = outletContext?.contentRef?.current;
    const prevScrollTop = scrollEl?.scrollTop ?? 0;
    ds.getFile(workspaceId, wildcardPath).then((f) => {
      setFile(f);
      if (scrollEl) {
        requestAnimationFrame(() => {
          scrollEl.scrollTop = prevScrollTop;
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletContext?.fileChangeEvent]);
```

Add the deleted-banner render branch, right after the existing `if (!file) return ...` line:

```tsx
  if (!file) return <div className="loading">Loading…</div>;
  if (deleted) {
    return (
      <article>
        <div className="doc-breadcrumb">{wildcardPath.split('/').join(' / ')}</div>
        <div className="file-deleted-banner">This file was deleted.</div>
      </article>
    );
  }
```

Append to `web/src/styles.css`:

```css
.file-deleted-banner {
  padding: 12px 16px;
  margin: 12px 0;
  background: rgba(248, 81, 73, 0.15);
  border: 1px solid rgba(248, 81, 73, 0.4);
  border-radius: 6px;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/routes/FileViewerPage.test.tsx`
Expected: PASS (all existing tests plus the 2 new ones).

- [ ] **Step 5: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
git add web/src/routes/FileViewerPage.tsx web/src/routes/FileViewerPage.test.tsx web/src/styles.css
git commit -m "feat: refresh open file in place on change, show banner on delete"
```

---

## Task 12: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Backend — format and full test suite**

Run:
```bash
cd /home/minhtuan/dev/local/dmox
gofmt -l .
CGO_ENABLED=1 go test -tags sqlite_fts5 ./...
```
Expected: `gofmt -l .` prints nothing; all Go tests PASS.

- [ ] **Step 2: Frontend — full test suite**

Run:
```bash
cd /home/minhtuan/dev/local/dmox/web
npm test -- run
```
Expected: all vitest suites PASS, including every file touched in Tasks 7–11.

- [ ] **Step 3: Frontend — typecheck and build**

Run:
```bash
cd /home/minhtuan/dev/local/dmox/web
npm run build
```
Expected: `tsc -b` reports no type errors (this is the first point the `WorkspaceOutletContext` and `DataSource` interface changes get checked against every consumer at once) and `vite build` succeeds.

- [ ] **Step 4: Full project build**

Run:
```bash
cd /home/minhtuan/dev/local/dmox
make build
```
Expected: succeeds, producing `bin/dmox` with the rebuilt frontend embedded.

- [ ] **Step 5: Manual smoke test**

Run `./bin/dmox serve` against a real config, open a workspace in the browser, and from a separate terminal edit a `.md` file inside the workspace's local source directory. Confirm: the tree updates without a manual reload, a toast appears, clicking "View diff" shows the change, and if the edited file is the one currently open, its content refreshes in place. This step is manual (not scripted) per the spec's testing section — filesystem-event timing makes it flaky to automate.

- [ ] **Step 6: Final commit (if any cleanup was needed)**

If Steps 1–4 required any fixes, stage and commit them:

```bash
cd /home/minhtuan/dev/local/dmox
git status
git add -A
git commit -m "chore: fix issues found during full-suite verification"
```

If nothing needed fixing, skip this step — there's nothing to commit.

---

## Self-Review Notes

- **Spec coverage:** Hub (Task 1), DiffCache (Task 2), `Store.GetFileBody` (Task 3), `App` wiring (Task 4), `watchAndReindex` publish+diff-record (Task 5), SSE + diff endpoints (Task 6), `DataSource` additions (Task 7), `ToastStack` (Task 8), `DiffModal` (Task 9), `WorkspaceLayout` wiring incl. debounced tree refetch and resync-on-reopen (Task 10), `FileViewerPage` refresh/delete-banner (Task 11) all map directly to sections of `docs/superpowers/specs/2026-07-20-realtime-sync-local-to-ui-design.md`. Manual verification (spec's "Manual verification" testing note) is Task 12 Step 5.
- **Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code.
- **Type consistency:** `ChangeEvent { sourceId, path, op }` and `FileDiff { available, old?, new? }` (Task 7) are used identically in Tasks 8–11. `livesync.Event { SourceID, Path, Op }` (Task 1) is used identically in Tasks 5–6. `WorkspaceOutletContext` (Task 10) fields `contentRef`/`fileChangeEvent` are consumed with the same names in Task 11.
