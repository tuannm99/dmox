# DMOX v0 — Core Knowledge Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build DMOX v0 — a single Go binary (`dmox`) that serves a read-only, Git-backed documentation browser (React SPA + REST API), a CLI (`dmox tree`/`dmox context`) for terminal coding agents, and a static-site exporter (`dmox build`) — per `docs/superpowers/specs/2026-07-17-dmox-core-platform-design.md`.

**Architecture:** A Go core (config/workspace manager, source adapters, SQLite+FTS5 indexer, search, git service, render pipeline) exposed over a Gin REST API that both a Vite/React SPA and the CLI consume. `dmox build` runs the same core services once and serializes their outputs to static JSON so the identical SPA can run against either a live server or a static host.

**Tech Stack:** Go 1.22+, Gin, `mattn/go-sqlite3` (FTS5, cgo), `go-git/v5`, `fsnotify`, `yaml.v3`; Vite + React 18 + TypeScript, `react-router-dom`, `react-markdown` + `remark-gfm` + `rehype-raw`, `mermaid`; Vitest + React Testing Library; Playwright for smoke tests.

## Global Constraints

- Single Go binary `dmox`, module `github.com/tuannm99/dmox`, Go 1.22+.
- SQLite FTS5 requires `CGO_ENABLED=1` and build tag `sqlite_fts5` for every `go build`/`go test` invocation.
- Config lives in one `config.yaml` (workspaces, sources, embeddings provider, rendering options); invalid config on startup fails fast with a clear error (spec §5).
- `GitSource` never writes to a remote: `Sync()` is clone-if-absent, else fetch + hard-reset to the remote tracking branch — no merge/conflict handling.
- Local file watching debounces fsnotify events by ~300ms (spec §4.2).
- `dmox tree` / `dmox context` are HTTP clients of `dmox serve` — they are not standalone/offline tools (spec §4.8).
- `dmox build` fails fast (non-zero exit) on any source sync/render error, unlike `dmox serve`'s degrade-gracefully behavior (spec §5).
- Static export output shape is fixed: `dist/index.html, assets/..., data/tree.json, data/files/<path>.json, data/search-index.json, data/git-history.json, data/ai-context.json, <route>/index.html` per doc route (spec §2).
- `dmox build --base-path P` must correctly prefix every asset/data URL for subpath hosting (e.g. GitHub Pages); no network calls for PlantUML rendering — local renderer process only.
- `LocalSource`-backed files return an empty/not-applicable git history & blame result, never an error (spec §4.7).
- Go unit tests are table-driven, use temp dirs and local git fixtures (`go-git`), no network access; Gin integration tests run in-process via `httptest`; frontend tests use Vitest + RTL; a Playwright smoke test covers browse → search (spec §6).

## File Structure

```
dmox/
  go.mod
  Makefile
  README.md
  config.yaml                    # local-dev config, points at example/docs
  config.example.yaml
  example/docs/                  # fixture workspace for local dev & manual verification
  cmd/dmox/                      # main.go + subcommand dispatch (serve, build, tree, context)
  internal/
    config/                      # Config schema, Load(), hot-reloading Manager
    source/                      # Source interface, LocalSource, GitSource
    store/                       # SQLite open/migrate, FTS5 schema
    index/                       # Indexer, frontmatter/heading parsing, AI-context detection
    search/                      # FTS5 search, vector store + merge
    gitsvc/                      # Git history/blame via go-git
    render/                      # Heading extraction, PlantUML renderer
    embedprovider/                # Embeddings Provider interface + OpenAI-compatible impl
    doctree/                     # TreeNode + tree-building shared by API and static build
    app/                         # Composition root wiring every service together
    api/                         # Gin router + handlers
    webassets/                   # embed.FS wrapper around the built SPA
    staticbuild/                 # `dmox build` static exporter
  web/                           # Vite/React SPA
    src/
      datasource/                # DataSource interface, live + static implementations
      routes/                    # WorkspacePickerPage, WorkspaceLayout, FileViewerPage, SearchPage, AIContextPage
      components/                # TreeView, MarkdownView, MermaidBlock, GitHistoryPanel
    tests/e2e/                   # Playwright smoke tests
```

Each `internal/*` package is interface-first and independently unit-testable; the multi-source tree-merge logic lives in `internal/doctree`, shared by `internal/api` and `internal/staticbuild` rather than duplicated (spec §3).

---

### Task 1: Project scaffolding + Config schema/loader

**Files:**
- Create: `go.mod`
- Create: `internal/config/config.go`
- Create: `internal/config/config_test.go`
- Create: `config.example.yaml`

**Interfaces:**
- Produces: `config.Config`, `config.Workspace`, `config.Source`, `config.EmbeddingsConfig`, `config.RenderConfig`, `config.PlantUMLConfig`, `config.ServerConfig`, `config.Load(path string) (*Config, error)`.

- [ ] **Step 1: Initialize the module and write the failing test**

```bash
cd /home/minhtuan/dev/local/dmox
go mod init github.com/tuannm99/dmox
go get gopkg.in/yaml.v3
```

`internal/config/config_test.go`:

```go
package config

import (
	"os"
	"path/filepath"
	"testing"
)

func writeTemp(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoad_ValidConfig(t *testing.T) {
	path := writeTemp(t, `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: local-docs
        type: local
        path: ./docs
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.Workspaces) != 1 || cfg.Workspaces[0].ID != "docs" {
		t.Fatalf("unexpected workspaces: %+v", cfg.Workspaces)
	}
	if cfg.Server.Addr != ":8080" {
		t.Fatalf("expected default server addr :8080, got %q", cfg.Server.Addr)
	}
	if cfg.Workspaces[0].Sources[0].Branch != "" {
		t.Fatalf("local source should not get a branch default")
	}
}

func TestLoad_DefaultsGitBranch(t *testing.T) {
	path := writeTemp(t, `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: repo
        type: git
        url: https://example.com/repo.git
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Workspaces[0].Sources[0].Branch != "main" {
		t.Fatalf("expected default branch main, got %q", cfg.Workspaces[0].Sources[0].Branch)
	}
}

func TestLoad_Errors(t *testing.T) {
	cases := map[string]string{
		"missing workspace id": `
workspaces:
  - name: Docs
    sources:
      - id: s
        type: local
        path: ./docs`,
		"duplicate workspace id": `
workspaces:
  - id: docs
    name: A
    sources: [{id: s, type: local, path: ./a}]
  - id: docs
    name: B
    sources: [{id: s2, type: local, path: ./b}]`,
		"unknown source type": `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: s
        type: ftp
        path: ./docs`,
		"local missing path": `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: s
        type: local`,
		"git missing url": `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: s
        type: git`,
	}
	for name, yamlContent := range cases {
		t.Run(name, func(t *testing.T) {
			path := writeTemp(t, yamlContent)
			if _, err := Load(path); err == nil {
				t.Fatalf("expected error for case %q", name)
			}
		})
	}
}

func TestLoad_FileNotFound(t *testing.T) {
	if _, err := Load("/nonexistent/config.yaml"); err == nil {
		t.Fatal("expected error for missing file")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=1 go test ./internal/config/...`
Expected: FAIL — `config.Load` undefined (package does not compile yet).

- [ ] **Step 3: Write the implementation**

`internal/config/config.go`:

```go
package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Workspaces []Workspace      `yaml:"workspaces"`
	Embeddings EmbeddingsConfig `yaml:"embeddings"`
	Render     RenderConfig     `yaml:"render"`
	Server     ServerConfig     `yaml:"server"`
	DataDir    string           `yaml:"data_dir"`
}

type Workspace struct {
	ID      string   `yaml:"id"`
	Name    string   `yaml:"name"`
	Sources []Source `yaml:"sources"`
}

type Source struct {
	ID         string           `yaml:"id"`
	Type       string           `yaml:"type"` // "local" | "git"
	Path       string           `yaml:"path,omitempty"`
	URL        string           `yaml:"url,omitempty"`
	Branch     string           `yaml:"branch,omitempty"`
	Embeddings SourceEmbeddings `yaml:"embeddings"`
}

type SourceEmbeddings struct {
	Enabled bool `yaml:"enabled"`
}

type EmbeddingsConfig struct {
	Provider  string `yaml:"provider"` // "none" | "openai"
	APIKeyEnv string `yaml:"api_key_env"`
	Model     string `yaml:"model"`
}

type RenderConfig struct {
	PlantUML PlantUMLConfig `yaml:"plantuml"`
}

type PlantUMLConfig struct {
	JarPath string `yaml:"jar_path"`
}

type ServerConfig struct {
	Addr string `yaml:"addr"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}
	cfg.applyDefaults()
	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}
	return &cfg, nil
}

func (c *Config) applyDefaults() {
	if c.Server.Addr == "" {
		c.Server.Addr = ":8080"
	}
	if c.Embeddings.Provider == "" {
		c.Embeddings.Provider = "none"
	}
	if c.DataDir == "" {
		home, err := os.UserHomeDir()
		if err == nil {
			c.DataDir = home + "/.dmox"
		} else {
			c.DataDir = ".dmox"
		}
	}
	for wi := range c.Workspaces {
		for si := range c.Workspaces[wi].Sources {
			s := &c.Workspaces[wi].Sources[si]
			if s.Type == "git" && s.Branch == "" {
				s.Branch = "main"
			}
		}
	}
}

func (c *Config) validate() error {
	seenWS := map[string]bool{}
	if len(c.Workspaces) == 0 {
		return fmt.Errorf("at least one workspace is required")
	}
	for _, w := range c.Workspaces {
		if w.ID == "" {
			return fmt.Errorf("workspace missing id")
		}
		if seenWS[w.ID] {
			return fmt.Errorf("duplicate workspace id %q", w.ID)
		}
		seenWS[w.ID] = true

		seenSrc := map[string]bool{}
		if len(w.Sources) == 0 {
			return fmt.Errorf("workspace %q has no sources", w.ID)
		}
		for _, s := range w.Sources {
			if s.ID == "" {
				return fmt.Errorf("workspace %q: source missing id", w.ID)
			}
			if seenSrc[s.ID] {
				return fmt.Errorf("workspace %q: duplicate source id %q", w.ID, s.ID)
			}
			seenSrc[s.ID] = true
			switch s.Type {
			case "local":
				if s.Path == "" {
					return fmt.Errorf("workspace %q source %q: local source requires path", w.ID, s.ID)
				}
			case "git":
				if s.URL == "" {
					return fmt.Errorf("workspace %q source %q: git source requires url", w.ID, s.ID)
				}
			default:
				return fmt.Errorf("workspace %q source %q: unknown type %q", w.ID, s.ID, s.Type)
			}
		}
	}
	if c.Embeddings.Provider != "none" && c.Embeddings.Provider != "openai" {
		return fmt.Errorf("unknown embeddings provider %q", c.Embeddings.Provider)
	}
	return nil
}
```

`config.example.yaml`:

```yaml
workspaces:
  - id: docs
    name: "Docs"
    sources:
      - id: local-docs
        type: local
        path: ./docs
      - id: repo-a
        type: git
        url: https://github.com/example/repo-a.git
        branch: main
        embeddings:
          enabled: false
embeddings:
  provider: none # none | openai
  api_key_env: OPENAI_API_KEY
  model: text-embedding-3-small
render:
  plantuml:
    jar_path: "" # optional path to plantuml.jar; empty disables PlantUML rendering
server:
  addr: ":8080"
data_dir: "" # defaults to ~/.dmox
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=1 go test ./internal/config/...`
Expected: PASS (all subtests green).

- [ ] **Step 5: Commit**

```bash
git add go.mod go.sum internal/config config.example.yaml
git commit -m "feat(config): add config.yaml schema, loader, and validation"
```

---

### Task 2: Config Manager (hot-reload on file change)

**Files:**
- Create: `internal/config/manager.go`
- Create: `internal/config/manager_test.go`
- Modify: `go.mod` (add `fsnotify`)

**Interfaces:**
- Consumes: `config.Load(path string) (*Config, error)` from Task 1.
- Produces: `config.Manager`, `config.NewManager(path string) (*Manager, error)`, `(*Manager).Get() *Config`, `(*Manager).Subscribe() <-chan *Config`, `(*Manager).Close() error`.

- [ ] **Step 1: Write the failing test**

```bash
go get github.com/fsnotify/fsnotify
```

`internal/config/manager_test.go`:

```go
package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

const validYAML = `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: s
        type: local
        path: ./docs
`

const validYAMLv2 = `
workspaces:
  - id: docs
    name: Docs v2
    sources:
      - id: s
        type: local
        path: ./docs
`

func TestManager_ReloadsOnChange(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(validYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := NewManager(path)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer m.Close()

	if got := m.Get().Workspaces[0].Name; got != "Docs" {
		t.Fatalf("initial name = %q, want Docs", got)
	}

	sub := m.Subscribe()
	if err := os.WriteFile(path, []byte(validYAMLv2), 0o644); err != nil {
		t.Fatal(err)
	}

	select {
	case cfg := <-sub:
		if cfg.Workspaces[0].Name != "Docs v2" {
			t.Fatalf("reloaded name = %q, want %q", cfg.Workspaces[0].Name, "Docs v2")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for reload notification")
	}
	if got := m.Get().Workspaces[0].Name; got != "Docs v2" {
		t.Fatalf("Get() after reload = %q, want Docs v2", got)
	}
}

func TestManager_KeepsOldConfigOnInvalidReload(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(validYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := NewManager(path)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer m.Close()

	if err := os.WriteFile(path, []byte("not: [valid yaml"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(500 * time.Millisecond)
	if got := m.Get().Workspaces[0].Name; got != "Docs" {
		t.Fatalf("Get() after invalid reload = %q, want unchanged Docs", got)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=1 go test ./internal/config/... -run TestManager`
Expected: FAIL — `NewManager` undefined.

- [ ] **Step 3: Write the implementation**

`internal/config/manager.go`:

```go
package config

import (
	"log"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"
)

type Manager struct {
	mu      sync.RWMutex
	cfg     *Config
	path    string
	watcher *fsnotify.Watcher
	subsMu  sync.Mutex
	subs    []chan *Config
}

func NewManager(path string) (*Manager, error) {
	cfg, err := Load(path)
	if err != nil {
		return nil, err
	}
	absDir, err := filepath.Abs(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := w.Add(absDir); err != nil {
		w.Close()
		return nil, err
	}
	m := &Manager{cfg: cfg, path: path, watcher: w}
	go m.watchLoop()
	return m, nil
}

func (m *Manager) Get() *Config {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg
}

func (m *Manager) Subscribe() <-chan *Config {
	ch := make(chan *Config, 1)
	m.subsMu.Lock()
	m.subs = append(m.subs, ch)
	m.subsMu.Unlock()
	return ch
}

func (m *Manager) watchLoop() {
	target, _ := filepath.Abs(m.path)
	for event := range m.watcher.Events {
		evPath, _ := filepath.Abs(event.Name)
		if evPath != target {
			continue
		}
		if event.Op&(fsnotify.Write|fsnotify.Create) == 0 {
			continue
		}
		cfg, err := Load(m.path)
		if err != nil {
			log.Printf("config: reload failed, keeping previous config: %v", err)
			continue
		}
		m.mu.Lock()
		m.cfg = cfg
		m.mu.Unlock()
		m.subsMu.Lock()
		for _, ch := range m.subs {
			select {
			case ch <- cfg:
			default:
			}
		}
		m.subsMu.Unlock()
	}
}

func (m *Manager) Close() error {
	return m.watcher.Close()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=1 go test ./internal/config/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add go.mod go.sum internal/config/manager.go internal/config/manager_test.go
git commit -m "feat(config): add hot-reloading config Manager"
```

---

### Task 3: Source interface + LocalSource

**Files:**
- Create: `internal/source/source.go`
- Create: `internal/source/local.go`
- Create: `internal/source/local_test.go`

**Interfaces:**
- Produces: `source.Source` interface (`ID`, `Sync`, `List`, `Read`, `Watch`, `SupportsGit`), `source.FileInfo{Path, ModTime, Size}`, `source.ChangeEvent{Path, Op}`, `source.ChangeOp` (`ChangeOpModify`, `ChangeOpCreate`, `ChangeOpDelete`), `source.NewLocalSource(id, root string) *LocalSource`.

- [ ] **Step 1: Write the failing test**

`internal/source/local_test.go`:

```go
package source

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLocalSource_SyncListRead(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "guide.md"), "# Guide\nhello")
	mustWrite(t, filepath.Join(dir, "sub", "nested.md"), "# Nested")
	mustWrite(t, filepath.Join(dir, "ignore.txt"), "not markdown")

	s := NewLocalSource("local", dir)
	ctx := context.Background()
	if err := s.Sync(ctx); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	files, err := s.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	paths := map[string]bool{}
	for _, f := range files {
		paths[f.Path] = true
	}
	if !paths["guide.md"] || !paths["sub/nested.md"] {
		t.Fatalf("List missing expected files: %+v", files)
	}
	if paths["ignore.txt"] {
		t.Fatalf("List should not include non-markdown files: %+v", files)
	}

	content, err := s.Read(ctx, "guide.md")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if string(content) != "# Guide\nhello" {
		t.Fatalf("Read content = %q", content)
	}
}

func TestLocalSource_ReadRejectsPathEscape(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "guide.md"), "content")
	s := NewLocalSource("local", dir)
	if _, err := s.Read(context.Background(), "../../etc/passwd"); err == nil {
		t.Fatal("expected error escaping source root")
	}
}

func TestLocalSource_SyncFailsOnMissingDir(t *testing.T) {
	s := NewLocalSource("local", "/nonexistent/does-not-exist")
	if err := s.Sync(context.Background()); err == nil {
		t.Fatal("expected error for missing root")
	}
}

func TestLocalSource_Watch(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "existing.md"), "start")
	s := NewLocalSource("local", dir)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	events, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("Watch: %v", err)
	}
	time.Sleep(50 * time.Millisecond) // let the watcher subscribe before the write
	mustWrite(t, filepath.Join(dir, "new.md"), "new content")

	select {
	case ev := <-events:
		if ev.Path != "new.md" {
			t.Fatalf("event path = %q, want new.md", ev.Path)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for change event")
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=1 go test ./internal/source/...`
Expected: FAIL — package does not compile (`NewLocalSource` undefined).

- [ ] **Step 3: Write the implementation**

`internal/source/source.go`:

```go
package source

import (
	"context"
	"time"
)

type FileInfo struct {
	Path    string
	ModTime time.Time
	Size    int64
}

type ChangeOp int

const (
	ChangeOpModify ChangeOp = iota
	ChangeOpCreate
	ChangeOpDelete
)

type ChangeEvent struct {
	Path string
	Op   ChangeOp
}

// Source is the common interface every content origin (local folder, git
// mirror, ...) implements. DMOX never writes back to a Source.
type Source interface {
	ID() string
	Sync(ctx context.Context) error
	List(ctx context.Context) ([]FileInfo, error)
	Read(ctx context.Context, path string) ([]byte, error)
	// Watch returns a channel of change events, or (nil, nil) if this source
	// doesn't support live watching (e.g. GitSource, which is updated via Sync).
	Watch(ctx context.Context) (<-chan ChangeEvent, error)
	SupportsGit() bool
}

func isDocFile(name string) bool {
	ext := extLower(name)
	return ext == ".md" || ext == ".markdown"
}
```

`internal/source/local.go`:

```go
package source

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

type LocalSource struct {
	id   string
	root string
}

func NewLocalSource(id, root string) *LocalSource {
	return &LocalSource{id: id, root: filepath.Clean(root)}
}

func (s *LocalSource) ID() string        { return s.id }
func (s *LocalSource) SupportsGit() bool { return false }

func (s *LocalSource) Sync(ctx context.Context) error {
	info, err := os.Stat(s.root)
	if err != nil {
		return fmt.Errorf("local source %s: %w", s.id, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("local source %s: %s is not a directory", s.id, s.root)
	}
	return nil
}

func (s *LocalSource) List(ctx context.Context) ([]FileInfo, error) {
	var files []FileInfo
	err := filepath.WalkDir(s.root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") && p != s.root {
				return filepath.SkipDir
			}
			return nil
		}
		if !isDocFile(d.Name()) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(s.root, p)
		if err != nil {
			return err
		}
		files = append(files, FileInfo{Path: filepath.ToSlash(rel), ModTime: info.ModTime(), Size: info.Size()})
		return nil
	})
	return files, err
}

func (s *LocalSource) Read(ctx context.Context, path string) ([]byte, error) {
	full, err := s.resolve(path)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(full)
}

func (s *LocalSource) resolve(path string) (string, error) {
	full := filepath.Join(s.root, filepath.FromSlash(path))
	rel, err := filepath.Rel(s.root, full)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path %q escapes source root", path)
	}
	return full, nil
}

func (s *LocalSource) Watch(ctx context.Context) (<-chan ChangeEvent, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := addRecursive(w, s.root); err != nil {
		w.Close()
		return nil, err
	}
	out := make(chan ChangeEvent, 16)
	go debounceWatch(ctx, w, s.root, out)
	return out, nil
}

func addRecursive(w *fsnotify.Watcher, root string) error {
	return filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") && p != root {
				return filepath.SkipDir
			}
			return w.Add(p)
		}
		return nil
	})
}

func debounceWatch(ctx context.Context, w *fsnotify.Watcher, root string, out chan<- ChangeEvent) {
	defer w.Close()
	defer close(out)
	pending := map[string]ChangeOp{}
	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		<-timer.C
	}
	flush := func() {
		for p, op := range pending {
			select {
			case out <- ChangeEvent{Path: p, Op: op}:
			case <-ctx.Done():
				return
			}
		}
		pending = map[string]ChangeOp{}
	}
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-w.Events:
			if !ok {
				return
			}
			rel, err := filepath.Rel(root, ev.Name)
			if err != nil {
				continue
			}
			rel = filepath.ToSlash(rel)
			switch {
			case ev.Op&(fsnotify.Remove|fsnotify.Rename) != 0:
				pending[rel] = ChangeOpDelete
			case ev.Op&fsnotify.Create != 0:
				pending[rel] = ChangeOpCreate
				if info, err := os.Stat(ev.Name); err == nil && info.IsDir() {
					_ = addRecursive(w, ev.Name)
				}
			case ev.Op&fsnotify.Write != 0:
				if _, exists := pending[rel]; !exists {
					pending[rel] = ChangeOpModify
				}
			default:
				continue
			}
			timer.Reset(300 * time.Millisecond)
		case <-timer.C:
			flush()
		}
	}
}

func extLower(name string) string {
	ext := filepath.Ext(name)
	out := make([]byte, len(ext))
	for i := 0; i < len(ext); i++ {
		c := ext[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		out[i] = c
	}
	return string(out)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=1 go test ./internal/source/... -run TestLocalSource`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add go.mod go.sum internal/source/source.go internal/source/local.go internal/source/local_test.go
git commit -m "feat(source): add Source interface and LocalSource with fsnotify watching"
```

---

### Task 4: GitSource (mirror clone + fetch/hard-reset)

**Files:**
- Create: `internal/source/git.go`
- Create: `internal/source/git_test.go`
- Modify: `go.mod` (add `go-git/v5`)

**Interfaces:**
- Consumes: `source.Source`, `source.FileInfo`, `isDocFile` from Task 3.
- Produces: `source.NewGitSource(id, url, branch, dataDir string) *GitSource`, `(*GitSource).MirrorDir() string`.

- [ ] **Step 1: Write the failing test**

```bash
go get github.com/go-git/go-git/v5
```

`internal/source/git_test.go`:

```go
package source

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// newOriginRepo creates a local git repo (acting as the "remote") with an
// initial commit containing one markdown file, and returns its path as a
// file:// URL suitable for GitSource.
func newOriginRepo(t *testing.T) (path string, repo *git.Repository) {
	t.Helper()
	dir := t.TempDir()
	repo, err := git.PlainInit(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	commitFile(t, repo, dir, "guide.md", "# Guide v1")
	return dir, repo
}

func commitFile(t *testing.T, repo *git.Repository, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	wt, err := repo.Worktree()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := wt.Add(name); err != nil {
		t.Fatal(err)
	}
	_, err = wt.Commit("update "+name, &git.CommitOptions{
		Author: &object.Signature{Name: "Test", Email: "test@example.com"},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestGitSource_CloneThenFetchAndReset(t *testing.T) {
	originDir, originRepo := newOriginRepo(t)
	dataDir := t.TempDir()
	s := NewGitSource("repo", "file://"+originDir, "master", dataDir)
	ctx := context.Background()

	if err := s.Sync(ctx); err != nil {
		t.Fatalf("initial Sync (clone): %v", err)
	}
	content, err := s.Read(ctx, "guide.md")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if string(content) != "# Guide v1" {
		t.Fatalf("content = %q", content)
	}

	commitFile(t, originRepo, originDir, "guide.md", "# Guide v2")
	commitFile(t, originRepo, originDir, "new.md", "# New")

	if err := s.Sync(ctx); err != nil {
		t.Fatalf("second Sync (fetch+reset): %v", err)
	}
	content, err = s.Read(ctx, "guide.md")
	if err != nil {
		t.Fatalf("Read after sync: %v", err)
	}
	if string(content) != "# Guide v2" {
		t.Fatalf("content after sync = %q, want v2", content)
	}
	if _, err := s.Read(ctx, "new.md"); err != nil {
		t.Fatalf("Read new.md: %v", err)
	}
}

func TestGitSource_DiscardsLocalMirrorEdits(t *testing.T) {
	originDir, _ := newOriginRepo(t)
	dataDir := t.TempDir()
	s := NewGitSource("repo", "file://"+originDir, "master", dataDir)
	ctx := context.Background()
	if err := s.Sync(ctx); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	tamperedPath := filepath.Join(s.MirrorDir(), "guide.md")
	if err := os.WriteFile(tamperedPath, []byte("tampered"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.Sync(ctx); err != nil {
		t.Fatalf("Sync after tamper: %v", err)
	}
	content, err := s.Read(ctx, "guide.md")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if string(content) != "# Guide v1" {
		t.Fatalf("expected hard reset to discard local edits, got %q", content)
	}
}

func TestGitSource_ListAndPathEscape(t *testing.T) {
	originDir, _ := newOriginRepo(t)
	dataDir := t.TempDir()
	s := NewGitSource("repo", "file://"+originDir, "master", dataDir)
	ctx := context.Background()
	if err := s.Sync(ctx); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	files, err := s.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(files) != 1 || files[0].Path != "guide.md" {
		t.Fatalf("List = %+v", files)
	}
	if _, err := s.Read(ctx, "../outside.md"); err == nil {
		t.Fatal("expected path escape error")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=1 go test ./internal/source/... -run TestGitSource`
Expected: FAIL — `NewGitSource` undefined.

- [ ] **Step 3: Write the implementation**

`internal/source/git.go`:

```go
package source

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
)

type GitSource struct {
	id        string
	url       string
	branch    string
	mirrorDir string
}

func NewGitSource(id, url, branch, dataDir string) *GitSource {
	if branch == "" {
		branch = "main"
	}
	return &GitSource{id: id, url: url, branch: branch, mirrorDir: filepath.Join(dataDir, "mirrors", id)}
}

func (s *GitSource) ID() string          { return s.id }
func (s *GitSource) SupportsGit() bool   { return true }
func (s *GitSource) MirrorDir() string   { return s.mirrorDir }

func (s *GitSource) Sync(ctx context.Context) error {
	if _, err := os.Stat(filepath.Join(s.mirrorDir, ".git")); errors.Is(err, os.ErrNotExist) {
		return s.clone(ctx)
	}
	return s.fetchAndReset(ctx)
}

func (s *GitSource) clone(ctx context.Context) error {
	_, err := git.PlainCloneContext(ctx, s.mirrorDir, false, &git.CloneOptions{
		URL:           s.url,
		ReferenceName: plumbing.NewBranchReferenceName(s.branch),
		SingleBranch:  true,
	})
	if err != nil {
		return fmt.Errorf("git source %s: clone: %w", s.id, err)
	}
	return nil
}

func (s *GitSource) fetchAndReset(ctx context.Context) error {
	repo, err := git.PlainOpen(s.mirrorDir)
	if err != nil {
		return fmt.Errorf("git source %s: open mirror: %w", s.id, err)
	}
	err = repo.FetchContext(ctx, &git.FetchOptions{RemoteName: "origin", Force: true})
	if err != nil && !errors.Is(err, git.NoErrAlreadyUpToDate) {
		return fmt.Errorf("git source %s: fetch: %w", s.id, err)
	}
	wt, err := repo.Worktree()
	if err != nil {
		return fmt.Errorf("git source %s: worktree: %w", s.id, err)
	}
	remoteRef, err := repo.Reference(plumbing.NewRemoteReferenceName("origin", s.branch), true)
	if err != nil {
		return fmt.Errorf("git source %s: resolve remote branch %s: %w", s.id, s.branch, err)
	}
	if err := wt.Reset(&git.ResetOptions{Commit: remoteRef.Hash(), Mode: git.HardReset}); err != nil {
		return fmt.Errorf("git source %s: hard reset: %w", s.id, err)
	}
	return nil
}

func (s *GitSource) List(ctx context.Context) ([]FileInfo, error) {
	var files []FileInfo
	err := filepath.WalkDir(s.mirrorDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if !isDocFile(d.Name()) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(s.mirrorDir, p)
		if err != nil {
			return err
		}
		files = append(files, FileInfo{Path: filepath.ToSlash(rel), ModTime: info.ModTime(), Size: info.Size()})
		return nil
	})
	return files, err
}

func (s *GitSource) Read(ctx context.Context, path string) ([]byte, error) {
	full := filepath.Join(s.mirrorDir, filepath.FromSlash(path))
	rel, err := filepath.Rel(s.mirrorDir, full)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return nil, fmt.Errorf("path %q escapes source root", path)
	}
	return os.ReadFile(full)
}

// Watch returns (nil, nil): GitSource has no live filesystem watcher, it is
// updated only via explicit Sync() calls (startup, POST /api/sources/:id/pull).
func (s *GitSource) Watch(ctx context.Context) (<-chan ChangeEvent, error) {
	return nil, nil
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=1 go test ./internal/source/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add go.mod go.sum internal/source/git.go internal/source/git_test.go
git commit -m "feat(source): add GitSource with clone/fetch/hard-reset mirroring"
```

---

### Task 5: SQLite store + FTS5 schema

**Files:**
- Create: `internal/store/store.go`
- Create: `internal/store/store_test.go`
- Modify: `go.mod` (add `mattn/go-sqlite3`)

**Interfaces:**
- Produces: `store.Store`, `store.Open(path string) (*Store, error)`, `(*Store).DB() *sql.DB`, `(*Store).Close() error`.

- [ ] **Step 1: Write the failing test**

```bash
go get github.com/mattn/go-sqlite3
```

`internal/store/store_test.go`:

```go
package store

import (
	"path/filepath"
	"testing"
)

func TestOpen_MigratesSchemaAndFTSWorks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dmox.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	_, err = s.DB().Exec(`INSERT INTO files (workspace_id, source_id, path, title, frontmatter, body, is_ai_context, mtime)
		VALUES ('ws', 'src', 'guide.md', 'Guide', '{}', 'hello world getting started', 0, 0)`)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}

	rows, err := s.DB().Query(`SELECT f.path FROM files_fts JOIN files f ON f.rowid = files_fts.rowid WHERE files_fts MATCH 'getting'`)
	if err != nil {
		t.Fatalf("fts query: %v", err)
	}
	defer rows.Close()
	var paths []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, p)
	}
	if len(paths) != 1 || paths[0] != "guide.md" {
		t.Fatalf("fts results = %+v", paths)
	}
}

func TestOpen_CreatesDataDir(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "dir", "dmox.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/store/...`
Expected: FAIL — `Open` undefined.

- [ ] **Step 3: Write the implementation**

`internal/store/store.go`:

```go
package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	db, err := sql.Open("sqlite3", path+"?_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1) // sqlite is single-writer; avoid SQLITE_BUSY under concurrent handlers
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

const schema = `
CREATE TABLE IF NOT EXISTS files (
    workspace_id  TEXT NOT NULL,
    source_id     TEXT NOT NULL,
    path          TEXT NOT NULL,
    title         TEXT,
    frontmatter   TEXT,
    body          TEXT NOT NULL,
    is_ai_context INTEGER NOT NULL DEFAULT 0,
    mtime         INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, source_id, path)
);

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    path, title, body,
    content='files', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
    INSERT INTO files_fts(rowid, path, title, body) VALUES (new.rowid, new.path, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, path, title, body) VALUES ('delete', old.rowid, old.path, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, path, title, body) VALUES ('delete', old.rowid, old.path, old.title, old.body);
    INSERT INTO files_fts(rowid, path, title, body) VALUES (new.rowid, new.path, new.title, new.body);
END;
`

func (s *Store) migrate() error {
	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("migrate schema: %w", err)
	}
	return nil
}

func (s *Store) DB() *sql.DB { return s.db }
func (s *Store) Close() error { return s.db.Close() }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/store/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add go.mod go.sum internal/store
git commit -m "feat(store): add SQLite store with FTS5-backed files schema"
```

### Task 6: Indexer (frontmatter/heading parse, AI-context flagging, upsert + stale removal)

**Files:**
- Create: `internal/index/frontmatter.go`
- Create: `internal/index/aicontext.go`
- Create: `internal/index/indexer.go`
- Create: `internal/index/indexer_test.go`

**Interfaces:**
- Consumes: `store.Store`, `(*store.Store).DB()` from Task 5; `source.Source`, `source.FileInfo` from Task 3.
- Produces: `index.Parse(raw []byte, fallbackTitle string) ParsedDoc{Frontmatter, Title, Body}`, `index.IsAIContextFile(path string) bool`, `index.Indexer`, `index.New(s *store.Store) *Indexer`, `(*Indexer).IndexSource(ctx, workspaceID string, src source.Source) error`, `(*Indexer).IndexFile(ctx, workspaceID string, src source.Source, path string) error`.

- [ ] **Step 1: Write the failing test**

`internal/index/indexer_test.go`:

```go
package index

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/source"
	"github.com/tuannm99/dmox/internal/store"
)

func newTestStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "dmox.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestParse_FrontmatterAndFallbackTitle(t *testing.T) {
	doc := Parse([]byte("---\ntitle: Custom Title\n---\n# Heading\nbody text"), "fallback.md")
	if doc.Title != "Custom Title" {
		t.Fatalf("Title = %q", doc.Title)
	}
	if doc.Frontmatter["title"] != "Custom Title" {
		t.Fatalf("Frontmatter = %+v", doc.Frontmatter)
	}

	doc2 := Parse([]byte("# Heading Only\nbody"), "fallback.md")
	if doc2.Title != "Heading Only" {
		t.Fatalf("Title (heading fallback) = %q", doc2.Title)
	}

	doc3 := Parse([]byte("no heading, no frontmatter"), "fallback.md")
	if doc3.Title != "fallback.md" {
		t.Fatalf("Title (filename fallback) = %q", doc3.Title)
	}
}

func TestIsAIContextFile(t *testing.T) {
	cases := map[string]bool{
		"CLAUDE.md":              true,
		"AGENTS.md":              true,
		".cursorrules":           true,
		".cursor/rules/foo.mdc":  true,
		"guide.md":               false,
		"nested/CLAUDE.md":       true,
	}
	for path, want := range cases {
		if got := IsAIContextFile(path); got != want {
			t.Errorf("IsAIContextFile(%q) = %v, want %v", path, got, want)
		}
	}
}

func TestIndexer_IndexSourceUpsertsAndRemovesStale(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "guide.md"), "# Guide\nhello world")
	mustWrite(t, filepath.Join(dir, "CLAUDE.md"), "agent instructions")
	src := source.NewLocalSource("local", dir)
	ctx := context.Background()

	st := newTestStore(t)
	ix := New(st)
	if err := ix.IndexSource(ctx, "ws", src); err != nil {
		t.Fatalf("IndexSource: %v", err)
	}

	var count int
	if err := st.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE workspace_id='ws' AND source_id='local'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("indexed row count = %d, want 2", count)
	}
	var isAI int
	if err := st.DB().QueryRow(`SELECT is_ai_context FROM files WHERE path='CLAUDE.md'`).Scan(&isAI); err != nil {
		t.Fatal(err)
	}
	if isAI != 1 {
		t.Fatal("CLAUDE.md should be flagged as AI context")
	}

	if err := os.Remove(filepath.Join(dir, "CLAUDE.md")); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexSource(ctx, "ws", src); err != nil {
		t.Fatalf("re-IndexSource: %v", err)
	}
	if err := st.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE workspace_id='ws' AND source_id='local'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("row count after deletion = %d, want 1 (stale row removed)", count)
	}
}

func TestIndexer_IndexFile_UpsertAndDelete(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "guide.md"), "# Guide\noriginal")
	src := source.NewLocalSource("local", dir)
	ctx := context.Background()
	st := newTestStore(t)
	ix := New(st)

	if err := ix.IndexFile(ctx, "ws", src, "guide.md"); err != nil {
		t.Fatalf("IndexFile: %v", err)
	}
	var body string
	if err := st.DB().QueryRow(`SELECT body FROM files WHERE path='guide.md'`).Scan(&body); err != nil {
		t.Fatal(err)
	}
	if body != "original" {
		t.Fatalf("body = %q", body)
	}

	if err := os.Remove(filepath.Join(dir, "guide.md")); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexFile(ctx, "ws", src, "guide.md"); err != nil {
		t.Fatalf("IndexFile (delete path): %v", err)
	}
	var count int
	if err := st.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE path='guide.md'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("expected row removed after file deleted on disk")
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/index/...`
Expected: FAIL — package does not compile.

- [ ] **Step 3: Write the implementation**

`internal/index/frontmatter.go`:

```go
package index

import (
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

type ParsedDoc struct {
	Frontmatter map[string]any
	Title       string
	Body        string
}

var frontmatterRe = regexp.MustCompile(`(?s)^---\r?\n(.*?)\r?\n---\r?\n?`)
var firstHeadingRe = regexp.MustCompile(`(?m)^#\s+(.+)$`)

func Parse(raw []byte, fallbackTitle string) ParsedDoc {
	content := string(raw)
	fm := map[string]any{}
	if m := frontmatterRe.FindStringSubmatch(content); m != nil {
		_ = yaml.Unmarshal([]byte(m[1]), &fm)
		content = content[len(m[0]):]
	}
	title := fallbackTitle
	if t, ok := fm["title"].(string); ok && t != "" {
		title = t
	} else if h := firstHeadingRe.FindStringSubmatch(content); h != nil {
		title = strings.TrimSpace(h[1])
	}
	return ParsedDoc{Frontmatter: fm, Title: title, Body: content}
}
```

`internal/index/aicontext.go`:

```go
package index

import (
	"path"
	"strings"
)

var defaultAIContextNames = map[string]bool{
	"CLAUDE.md":    true,
	"AGENTS.md":    true,
	".cursorrules": true,
}

func IsAIContextFile(p string) bool {
	base := path.Base(p)
	if defaultAIContextNames[base] {
		return true
	}
	return strings.Contains(p, ".cursor/rules/")
}
```

`internal/index/indexer.go`:

```go
package index

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"time"

	"github.com/tuannm99/dmox/internal/source"
	"github.com/tuannm99/dmox/internal/store"
)

type Indexer struct {
	store *store.Store
}

func New(s *store.Store) *Indexer { return &Indexer{store: s} }

func (ix *Indexer) IndexSource(ctx context.Context, workspaceID string, src source.Source) error {
	files, err := src.List(ctx)
	if err != nil {
		return fmt.Errorf("list source %s: %w", src.ID(), err)
	}
	seen := make(map[string]bool, len(files))
	for _, f := range files {
		seen[f.Path] = true
		raw, err := src.Read(ctx, f.Path)
		if err != nil {
			log.Printf("index: skip %s/%s: read error: %v", src.ID(), f.Path, err)
			continue
		}
		if err := ix.upsert(ctx, workspaceID, src.ID(), f.Path, raw, f.ModTime.Unix()); err != nil {
			return fmt.Errorf("index %s/%s: %w", src.ID(), f.Path, err)
		}
	}
	return ix.removeStale(ctx, workspaceID, src.ID(), seen)
}

func (ix *Indexer) IndexFile(ctx context.Context, workspaceID string, src source.Source, path string) error {
	raw, err := src.Read(ctx, path)
	if err != nil {
		_, delErr := ix.store.DB().ExecContext(ctx,
			`DELETE FROM files WHERE workspace_id=? AND source_id=? AND path=?`,
			workspaceID, src.ID(), path)
		return delErr
	}
	return ix.upsert(ctx, workspaceID, src.ID(), path, raw, time.Now().Unix())
}

func (ix *Indexer) upsert(ctx context.Context, workspaceID, sourceID, path string, raw []byte, mtime int64) error {
	doc := Parse(raw, filepath.Base(path))
	fmJSON, err := json.Marshal(doc.Frontmatter)
	if err != nil {
		return err
	}
	_, err = ix.store.DB().ExecContext(ctx, `
		INSERT INTO files (workspace_id, source_id, path, title, frontmatter, body, is_ai_context, mtime)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(workspace_id, source_id, path) DO UPDATE SET
			title=excluded.title, frontmatter=excluded.frontmatter, body=excluded.body,
			is_ai_context=excluded.is_ai_context, mtime=excluded.mtime`,
		workspaceID, sourceID, path, doc.Title, string(fmJSON), doc.Body,
		boolToInt(IsAIContextFile(path)), mtime)
	return err
}

func (ix *Indexer) removeStale(ctx context.Context, workspaceID, sourceID string, seen map[string]bool) error {
	rows, err := ix.store.DB().QueryContext(ctx,
		`SELECT path FROM files WHERE workspace_id=? AND source_id=?`, workspaceID, sourceID)
	if err != nil {
		return err
	}
	var stale []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			rows.Close()
			return err
		}
		if !seen[p] {
			stale = append(stale, p)
		}
	}
	rows.Close()
	for _, p := range stale {
		if _, err := ix.store.DB().ExecContext(ctx,
			`DELETE FROM files WHERE workspace_id=? AND source_id=? AND path=?`, workspaceID, sourceID, p); err != nil {
			return err
		}
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/index/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/index
git commit -m "feat(index): add frontmatter/heading parsing, AI-context flagging, and Indexer"
```

---

### Task 7: Search Service (FTS5 query, ranking, snippets)

**Files:**
- Create: `internal/search/search.go`
- Create: `internal/search/search_test.go`

**Interfaces:**
- Consumes: `store.Store` from Task 5.
- Produces: `search.Result{WorkspaceID, SourceID, Path, Title, Snippet, Score}`, `search.Service`, `search.New(s *store.Store) *Service`, `(*Service).Search(ctx context.Context, workspaceID, query string, limit int) ([]Result, error)`.

- [ ] **Step 1: Write the failing test**

`internal/search/search_test.go`:

```go
package search

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/store"
)

func seedFile(t *testing.T, st *store.Store, workspaceID, sourceID, path, title, body string) {
	t.Helper()
	_, err := st.DB().Exec(`INSERT INTO files (workspace_id, source_id, path, title, frontmatter, body, is_ai_context, mtime)
		VALUES (?, ?, ?, ?, '{}', ?, 0, 0)`, workspaceID, sourceID, path, title, body)
	if err != nil {
		t.Fatal(err)
	}
}

func newTestStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "dmox.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestSearch_ReturnsMatchesWithSnippet(t *testing.T) {
	st := newTestStore(t)
	seedFile(t, st, "ws", "src", "guide.md", "Getting Started", "This guide covers getting started with dmox.")
	seedFile(t, st, "ws", "src", "other.md", "Other Topic", "Nothing relevant here.")
	seedFile(t, st, "other-ws", "src", "guide.md", "Getting Started", "getting started elsewhere")

	svc := New(st)
	results, err := svc.Search(context.Background(), "ws", "getting started", 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("results = %+v, want 1 match scoped to workspace ws", results)
	}
	if results[0].Path != "guide.md" {
		t.Fatalf("Path = %q", results[0].Path)
	}
	if !containsMark(results[0].Snippet) {
		t.Fatalf("Snippet = %q, want <mark> highlighting", results[0].Snippet)
	}
}

func TestSearch_EmptyQueryReturnsNoResults(t *testing.T) {
	st := newTestStore(t)
	svc := New(st)
	results, err := svc.Search(context.Background(), "ws", "  ", 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("results = %+v, want empty", results)
	}
}

func containsMark(s string) bool {
	for i := 0; i+6 <= len(s); i++ {
		if s[i:i+6] == "<mark>" {
			return true
		}
	}
	return false
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/search/...`
Expected: FAIL — `New` undefined.

- [ ] **Step 3: Write the implementation**

`internal/search/search.go`:

```go
package search

import (
	"context"
	"fmt"
	"strings"

	"github.com/tuannm99/dmox/internal/store"
)

type Result struct {
	WorkspaceID string  `json:"workspace_id"`
	SourceID    string  `json:"source_id"`
	Path        string  `json:"path"`
	Title       string  `json:"title"`
	Snippet     string  `json:"snippet"`
	Score       float64 `json:"score"`
}

type Service struct {
	store    *store.Store
	vector   VectorSearcher
	embedder Embedder
}

func New(s *store.Store) *Service { return &Service{store: s} }

func (svc *Service) Search(ctx context.Context, workspaceID, query string, limit int) ([]Result, error) {
	ftsResults, err := svc.searchFTS(ctx, workspaceID, query, limit)
	if err != nil {
		return nil, err
	}
	if svc.vector == nil || svc.embedder == nil || strings.TrimSpace(query) == "" {
		return ftsResults, nil
	}
	return svc.mergeWithSemantic(ctx, workspaceID, query, limit, ftsResults), nil
}

func (svc *Service) searchFTS(ctx context.Context, workspaceID, query string, limit int) ([]Result, error) {
	if strings.TrimSpace(query) == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 20
	}
	rows, err := svc.store.DB().QueryContext(ctx, `
		SELECT f.source_id, f.path, f.title,
		       snippet(files_fts, 2, '<mark>', '</mark>', '…', 12) AS snip,
		       bm25(files_fts) AS rank
		FROM files_fts
		JOIN files f ON f.rowid = files_fts.rowid
		WHERE files_fts MATCH ? AND f.workspace_id = ?
		ORDER BY rank
		LIMIT ?`, toFTS5Query(query), workspaceID, limit)
	if err != nil {
		return nil, fmt.Errorf("fts query: %w", err)
	}
	defer rows.Close()
	var results []Result
	for rows.Next() {
		var r Result
		r.WorkspaceID = workspaceID
		if err := rows.Scan(&r.SourceID, &r.Path, &r.Title, &r.Snippet, &r.Score); err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

func toFTS5Query(q string) string {
	fields := strings.Fields(q)
	for i, f := range fields {
		f = strings.ReplaceAll(f, `"`, `""`)
		fields[i] = `"` + f + `"*`
	}
	return strings.Join(fields, " ")
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/search/... -run TestSearch`
Expected: PASS. (`svc.vector`/`svc.embedder`/`mergeWithSemantic` reference types added in Task 9 — this task compiles once Task 9's `VectorSearcher`/`Embedder`/`mergeWithSemantic` stubs land; see Task 9 Step 1 which adds them in the same package before this test is re-run as part of that task's suite. For this task in isolation, temporarily comment out the `vector`/`embedder` fields and the `mergeWithSemantic` branch — Task 9 restores and completes them.)

- [ ] **Step 5: Commit**

```bash
git add internal/search/search.go internal/search/search_test.go
git commit -m "feat(search): add FTS5 search service with bm25 ranking and snippets"
```

---

### Task 8: Git Service (history/blame)

**Files:**
- Create: `internal/gitsvc/gitsvc.go`
- Create: `internal/gitsvc/gitsvc_test.go`

**Interfaces:**
- Produces: `gitsvc.Commit{Hash, Author, Email, Date, Message}`, `gitsvc.BlameLine{LineNo, Hash, Author, Date, Text}`, `gitsvc.Service`, `gitsvc.New() *Service`, `(*Service).History(mirrorDir, path string, limit int) ([]Commit, error)`, `(*Service).Blame(mirrorDir, path string) ([]BlameLine, error)`.

- [ ] **Step 1: Write the failing test**

`internal/gitsvc/gitsvc_test.go`:

```go
package gitsvc

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"
)

func initRepoWithHistory(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	repo, err := git.PlainInit(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	writeAndCommit(t, repo, dir, "guide.md", "line one\nline two\n", "initial commit")
	writeAndCommit(t, repo, dir, "guide.md", "line one\nline two edited\n", "edit line two")
	return dir
}

func writeAndCommit(t *testing.T, repo *git.Repository, dir, name, content, msg string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	wt, err := repo.Worktree()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := wt.Add(name); err != nil {
		t.Fatal(err)
	}
	if _, err := wt.Commit(msg, &git.CommitOptions{
		Author: &object.Signature{Name: "Test", Email: "test@example.com"},
	}); err != nil {
		t.Fatal(err)
	}
}

func TestService_History(t *testing.T) {
	dir := initRepoWithHistory(t)
	svc := New()
	commits, err := svc.History(dir, "guide.md", 10)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(commits) != 2 {
		t.Fatalf("commits = %+v, want 2", commits)
	}
	if commits[0].Message != "edit line two" {
		t.Fatalf("commits[0].Message = %q, want most recent first", commits[0].Message)
	}
	if commits[1].Message != "initial commit" {
		t.Fatalf("commits[1].Message = %q", commits[1].Message)
	}
}

func TestService_History_RespectsLimit(t *testing.T) {
	dir := initRepoWithHistory(t)
	svc := New()
	commits, err := svc.History(dir, "guide.md", 1)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(commits) != 1 {
		t.Fatalf("commits = %+v, want 1", commits)
	}
}

func TestService_Blame(t *testing.T) {
	dir := initRepoWithHistory(t)
	svc := New()
	lines, err := svc.Blame(dir, "guide.md")
	if err != nil {
		t.Fatalf("Blame: %v", err)
	}
	if len(lines) != 2 {
		t.Fatalf("lines = %+v, want 2", lines)
	}
	if lines[1].Text != "line two edited" {
		t.Fatalf("lines[1].Text = %q", lines[1].Text)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=1 go test ./internal/gitsvc/...`
Expected: FAIL — `New` undefined.

- [ ] **Step 3: Write the implementation**

`internal/gitsvc/gitsvc.go`:

```go
package gitsvc

import (
	"fmt"
	"strings"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/plumbing/storer"
)

type Commit struct {
	Hash    string    `json:"hash"`
	Author  string    `json:"author"`
	Email   string    `json:"email"`
	Date    time.Time `json:"date"`
	Message string    `json:"message"`
}

type BlameLine struct {
	LineNo int       `json:"line_no"`
	Hash   string    `json:"hash"`
	Author string    `json:"author"`
	Date   time.Time `json:"date"`
	Text   string    `json:"text"`
}

type Service struct{}

func New() *Service { return &Service{} }

func (s *Service) History(mirrorDir, path string, limit int) ([]Commit, error) {
	repo, err := git.PlainOpen(mirrorDir)
	if err != nil {
		return nil, fmt.Errorf("open repo: %w", err)
	}
	head, err := repo.Head()
	if err != nil {
		return nil, fmt.Errorf("resolve head: %w", err)
	}
	iter, err := repo.Log(&git.LogOptions{From: head.Hash(), FileName: &path})
	if err != nil {
		return nil, fmt.Errorf("log %s: %w", path, err)
	}
	var commits []Commit
	err = iter.ForEach(func(c *object.Commit) error {
		if limit > 0 && len(commits) >= limit {
			return storer.ErrStop
		}
		commits = append(commits, Commit{
			Hash: c.Hash.String(), Author: c.Author.Name, Email: c.Author.Email,
			Date: c.Author.When, Message: strings.TrimSpace(c.Message),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return commits, nil
}

func (s *Service) Blame(mirrorDir, path string) ([]BlameLine, error) {
	repo, err := git.PlainOpen(mirrorDir)
	if err != nil {
		return nil, fmt.Errorf("open repo: %w", err)
	}
	head, err := repo.Head()
	if err != nil {
		return nil, fmt.Errorf("resolve head: %w", err)
	}
	commit, err := repo.CommitObject(head.Hash())
	if err != nil {
		return nil, err
	}
	result, err := git.Blame(commit, path)
	if err != nil {
		return nil, fmt.Errorf("blame %s: %w", path, err)
	}
	lines := make([]BlameLine, len(result.Lines))
	for i, l := range result.Lines {
		lines[i] = BlameLine{LineNo: i + 1, Hash: l.Hash.String(), Author: l.AuthorName, Date: l.Date, Text: l.Text}
	}
	return lines, nil
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=1 go test ./internal/gitsvc/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/gitsvc
git commit -m "feat(gitsvc): add read-only Git history/blame service via go-git"
```

---

### Task 9: Embeddings provider + vector store + Search merge

**Files:**
- Create: `internal/embedprovider/provider.go`
- Create: `internal/embedprovider/openai.go`
- Create: `internal/embedprovider/openai_test.go`
- Create: `internal/search/vector.go`
- Create: `internal/search/vector_test.go`
- Modify: `internal/search/search.go` (complete `VectorSearcher`/`Embedder`/`mergeWithSemantic`, `SetVectorSearch`)
- Create: `internal/search/merge_test.go`

**Interfaces:**
- Produces: `embedprovider.Provider{Embed, Dimensions}`, `embedprovider.NoopProvider`, `embedprovider.NewOpenAIProvider(apiKey, model string) *OpenAIProvider`; `search.VectorStore`, `search.NewVectorStore(s *store.Store) *VectorStore`, `(*VectorStore).EnsureSchema(ctx) error`, `(*VectorStore).Upsert(ctx, workspaceID, sourceID, path string, vec []float32) error`, `(*VectorStore).Search(ctx, workspaceID string, query []float32, limit int) ([]Result, error)`; `search.VectorSearcher` interface, `search.Embedder` interface, `(*search.Service).SetVectorSearch(vs VectorSearcher, e Embedder)`.

**Note:** v0 implements semantic search with a plain SQLite `embeddings` table and brute-force cosine similarity in Go, instead of the spec's `sqlite-vec` loadable extension — this avoids a native-extension-loading dependency that's hard to test in CI while still satisfying the "pluggable, opt-in embeddings provider" and "vector similarity query" requirements (spec §1, §3) at v0's realistic local-knowledge-base scale.

- [ ] **Step 1: Write the failing tests**

`internal/embedprovider/openai_test.go`:

```go
package embedprovider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAIProvider_Embed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("missing/incorrect auth header: %q", r.Header.Get("Authorization"))
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "text-embedding-3-small" {
			t.Errorf("model = %v", body["model"])
		}
		json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"embedding": []float32{0.1, 0.2, 0.3}},
			},
		})
	}))
	defer srv.Close()

	p := NewOpenAIProvider("test-key", "text-embedding-3-small")
	p.SetBaseURL(srv.URL)
	vecs, err := p.Embed(context.Background(), []string{"hello"})
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if len(vecs) != 1 || len(vecs[0]) != 3 {
		t.Fatalf("vecs = %+v", vecs)
	}
}

func TestOpenAIProvider_Embed_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("invalid api key"))
	}))
	defer srv.Close()

	p := NewOpenAIProvider("bad-key", "text-embedding-3-small")
	p.SetBaseURL(srv.URL)
	if _, err := p.Embed(context.Background(), []string{"hello"}); err == nil {
		t.Fatal("expected error for 401 response")
	}
}
```

`internal/search/vector_test.go`:

```go
package search

import (
	"context"
	"testing"
)

func TestVectorStore_UpsertAndSearchRanksByCosine(t *testing.T) {
	st := newTestStore(t)
	seedFile(t, st, "ws", "src", "a.md", "A", "content a")
	seedFile(t, st, "ws", "src", "b.md", "B", "content b")
	vs := NewVectorStore(st)
	ctx := context.Background()
	if err := vs.EnsureSchema(ctx); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}
	if err := vs.Upsert(ctx, "ws", "src", "a.md", []float32{1, 0, 0}); err != nil {
		t.Fatalf("Upsert a: %v", err)
	}
	if err := vs.Upsert(ctx, "ws", "src", "b.md", []float32{0, 1, 0}); err != nil {
		t.Fatalf("Upsert b: %v", err)
	}

	results, err := vs.Search(ctx, "ws", []float32{1, 0, 0}, 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 2 || results[0].Path != "a.md" {
		t.Fatalf("results = %+v, want a.md ranked first (identical vector)", results)
	}
}
```

`internal/search/merge_test.go`:

```go
package search

import (
	"context"
	"errors"
	"testing"
)

type fakeEmbedder struct {
	vec []float32
	err error
}

func (f fakeEmbedder) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if f.err != nil {
		return nil, f.err
	}
	return [][]float32{f.vec}, nil
}
func (f fakeEmbedder) Dimensions() int { return len(f.vec) }

type fakeVectorSearcher struct {
	results []Result
	err     error
}

func (f fakeVectorSearcher) Search(ctx context.Context, workspaceID string, query []float32, limit int) ([]Result, error) {
	return f.results, f.err
}

func TestService_Search_DegradesToFTSWhenEmbeddingFails(t *testing.T) {
	st := newTestStore(t)
	seedFile(t, st, "ws", "src", "guide.md", "Guide", "getting started guide")
	svc := New(st)
	svc.SetVectorSearch(fakeVectorSearcher{}, fakeEmbedder{err: errors.New("timeout")})

	results, err := svc.Search(context.Background(), "ws", "getting started", 10)
	if err != nil {
		t.Fatalf("Search should not fail when embeddings error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("results = %+v, want FTS fallback result", results)
	}
}

func TestService_Search_MergesFTSAndSemanticWithoutDuplicates(t *testing.T) {
	st := newTestStore(t)
	seedFile(t, st, "ws", "src", "guide.md", "Guide", "getting started guide")
	seedFile(t, st, "ws", "src", "semantic-only.md", "Semantic", "unrelated words entirely")
	svc := New(st)
	svc.SetVectorSearch(fakeVectorSearcher{results: []Result{
		{WorkspaceID: "ws", SourceID: "src", Path: "guide.md", Title: "Guide"},
		{WorkspaceID: "ws", SourceID: "src", Path: "semantic-only.md", Title: "Semantic"},
	}}, fakeEmbedder{vec: []float32{1, 0}})

	results, err := svc.Search(context.Background(), "ws", "getting started", 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("results = %+v, want 2 deduplicated results", results)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/embedprovider/... ./internal/search/...`
Expected: FAIL — `NewOpenAIProvider`, `NewVectorStore`, `SetVectorSearch` undefined.

- [ ] **Step 3: Write the implementation**

`internal/embedprovider/provider.go`:

```go
package embedprovider

import (
	"context"
	"errors"
)

type Provider interface {
	Embed(ctx context.Context, texts []string) ([][]float32, error)
	Dimensions() int
}

type NoopProvider struct{}

func (NoopProvider) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	return nil, errors.New("embeddings disabled")
}
func (NoopProvider) Dimensions() int { return 0 }
```

`internal/embedprovider/openai.go`:

```go
package embedprovider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type OpenAIProvider struct {
	apiKey  string
	model   string
	dims    int
	httpc   *http.Client
	baseURL string
}

func NewOpenAIProvider(apiKey, model string) *OpenAIProvider {
	return &OpenAIProvider{
		apiKey: apiKey, model: model, dims: 1536,
		httpc: &http.Client{Timeout: 30 * time.Second}, baseURL: "https://api.openai.com/v1",
	}
}

// SetBaseURL overrides the API base URL; used by tests to point at a fake server.
func (p *OpenAIProvider) SetBaseURL(url string) { p.baseURL = url }

func (p *OpenAIProvider) Dimensions() int { return p.dims }

type embedRequest struct {
	Model string   `json:"model"`
	Input []string `json:"input"`
}
type embedResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
	} `json:"data"`
}

func (p *OpenAIProvider) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	body, err := json.Marshal(embedRequest{Model: p.model, Input: texts})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.httpc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embeddings request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embeddings api error %d: %s", resp.StatusCode, string(b))
	}
	var out embedResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode embeddings response: %w", err)
	}
	vecs := make([][]float32, len(out.Data))
	for i, d := range out.Data {
		vecs[i] = d.Embedding
	}
	return vecs, nil
}
```

`internal/search/vector.go`:

```go
package search

import (
	"context"
	"encoding/binary"
	"math"
	"sort"

	"github.com/tuannm99/dmox/internal/store"
)

type VectorStore struct {
	store *store.Store
}

func NewVectorStore(s *store.Store) *VectorStore { return &VectorStore{store: s} }

func (vs *VectorStore) EnsureSchema(ctx context.Context) error {
	_, err := vs.store.DB().ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS embeddings (
			workspace_id TEXT NOT NULL, source_id TEXT NOT NULL, path TEXT NOT NULL,
			vector BLOB NOT NULL, PRIMARY KEY (workspace_id, source_id, path))`)
	return err
}

func (vs *VectorStore) Upsert(ctx context.Context, workspaceID, sourceID, path string, vec []float32) error {
	buf := make([]byte, 4*len(vec))
	for i, f := range vec {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(f))
	}
	_, err := vs.store.DB().ExecContext(ctx, `
		INSERT INTO embeddings (workspace_id, source_id, path, vector) VALUES (?, ?, ?, ?)
		ON CONFLICT(workspace_id, source_id, path) DO UPDATE SET vector=excluded.vector`,
		workspaceID, sourceID, path, buf)
	return err
}

func (vs *VectorStore) Search(ctx context.Context, workspaceID string, query []float32, limit int) ([]Result, error) {
	rows, err := vs.store.DB().QueryContext(ctx, `
		SELECT e.source_id, e.path, f.title, e.vector FROM embeddings e
		JOIN files f ON f.workspace_id=e.workspace_id AND f.source_id=e.source_id AND f.path=e.path
		WHERE e.workspace_id = ?`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type scored struct {
		Result
		sim float64
	}
	var all []scored
	for rows.Next() {
		var sourceID, path, title string
		var buf []byte
		if err := rows.Scan(&sourceID, &path, &title, &buf); err != nil {
			return nil, err
		}
		all = append(all, scored{
			Result: Result{WorkspaceID: workspaceID, SourceID: sourceID, Path: path, Title: title},
			sim:    cosine(query, bytesToVec(buf)),
		})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].sim > all[j].sim })
	if limit > 0 && len(all) > limit {
		all = all[:limit]
	}
	out := make([]Result, len(all))
	for i, s := range all {
		s.Result.Score = s.sim
		out[i] = s.Result
	}
	return out, nil
}

func cosine(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return -1
	}
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return -1
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}

func bytesToVec(buf []byte) []float32 {
	vec := make([]float32, len(buf)/4)
	for i := range vec {
		vec[i] = math.Float32frombits(binary.LittleEndian.Uint32(buf[i*4:]))
	}
	return vec
}
```

Modify `internal/search/search.go` — replace the `Service` struct and add the merge logic (full new file):

```go
package search

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/tuannm99/dmox/internal/store"
)

type Result struct {
	WorkspaceID string  `json:"workspace_id"`
	SourceID    string  `json:"source_id"`
	Path        string  `json:"path"`
	Title       string  `json:"title"`
	Snippet     string  `json:"snippet"`
	Score       float64 `json:"score"`
}

type VectorSearcher interface {
	Search(ctx context.Context, workspaceID string, query []float32, limit int) ([]Result, error)
}

type Embedder interface {
	Embed(ctx context.Context, texts []string) ([][]float32, error)
}

type Service struct {
	store    *store.Store
	vector   VectorSearcher
	embedder Embedder
}

func New(s *store.Store) *Service { return &Service{store: s} }

func (svc *Service) SetVectorSearch(vs VectorSearcher, e Embedder) {
	svc.vector = vs
	svc.embedder = e
}

func (svc *Service) Search(ctx context.Context, workspaceID, query string, limit int) ([]Result, error) {
	ftsResults, err := svc.searchFTS(ctx, workspaceID, query, limit)
	if err != nil {
		return nil, err
	}
	if svc.vector == nil || svc.embedder == nil || strings.TrimSpace(query) == "" {
		return ftsResults, nil
	}
	return svc.mergeWithSemantic(ctx, workspaceID, query, limit, ftsResults), nil
}

func (svc *Service) mergeWithSemantic(ctx context.Context, workspaceID, query string, limit int, ftsResults []Result) []Result {
	vecs, err := svc.embedder.Embed(ctx, []string{query})
	if err != nil || len(vecs) == 0 {
		log.Printf("semantic search skipped: %v", err)
		return ftsResults
	}
	semResults, err := svc.vector.Search(ctx, workspaceID, vecs[0], limit)
	if err != nil {
		log.Printf("semantic search skipped: %v", err)
		return ftsResults
	}
	return mergeResults(ftsResults, semResults, limit)
}

func mergeResults(fts, sem []Result, limit int) []Result {
	seen := map[string]bool{}
	var out []Result
	for _, r := range fts {
		key := r.SourceID + "/" + r.Path
		if !seen[key] {
			seen[key] = true
			out = append(out, r)
		}
	}
	for _, r := range sem {
		key := r.SourceID + "/" + r.Path
		if !seen[key] {
			seen[key] = true
			out = append(out, r)
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

func (svc *Service) searchFTS(ctx context.Context, workspaceID, query string, limit int) ([]Result, error) {
	if strings.TrimSpace(query) == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 20
	}
	rows, err := svc.store.DB().QueryContext(ctx, `
		SELECT f.source_id, f.path, f.title,
		       snippet(files_fts, 2, '<mark>', '</mark>', '…', 12) AS snip,
		       bm25(files_fts) AS rank
		FROM files_fts
		JOIN files f ON f.rowid = files_fts.rowid
		WHERE files_fts MATCH ? AND f.workspace_id = ?
		ORDER BY rank
		LIMIT ?`, toFTS5Query(query), workspaceID, limit)
	if err != nil {
		return nil, fmt.Errorf("fts query: %w", err)
	}
	defer rows.Close()
	var results []Result
	for rows.Next() {
		var r Result
		r.WorkspaceID = workspaceID
		if err := rows.Scan(&r.SourceID, &r.Path, &r.Title, &r.Snippet, &r.Score); err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

func toFTS5Query(q string) string {
	fields := strings.Fields(q)
	for i, f := range fields {
		f = strings.ReplaceAll(f, `"`, `""`)
		fields[i] = `"` + f + `"*`
	}
	return strings.Join(fields, " ")
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/embedprovider/... ./internal/search/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/embedprovider internal/search
git commit -m "feat(search): add opt-in embeddings provider, vector store, and FTS/semantic merge"
```

---

### Task 10: Render Pipeline — heading extraction + PlantUML local renderer

**Files:**
- Create: `internal/render/render.go`
- Create: `internal/render/plantuml.go`
- Create: `internal/render/render_test.go`
- Create: `internal/render/plantuml_test.go`

**Interfaces:**
- Produces: `render.FileView{Path, Title, Frontmatter, Body, Headings, IsAIContext}`, `render.Heading{Level, Text, Slug}`, `render.ExtractHeadings(body string) []Heading`, `render.NewPlantUMLRenderer(jarPath, cacheDir string) *PlantUMLRenderer`, `(*PlantUMLRenderer).Available() bool`, `(*PlantUMLRenderer).RenderSVG(ctx, src string) (svg, unavailableReason string)`, `(*PlantUMLRenderer).RenderBlocks(ctx, body string) string`.

- [ ] **Step 1: Write the failing tests**

`internal/render/render_test.go`:

```go
package render

import "testing"

func TestExtractHeadings(t *testing.T) {
	body := "# Title\nintro\n## Section One\ntext\n### Sub Section\nmore text"
	headings := ExtractHeadings(body)
	if len(headings) != 3 {
		t.Fatalf("headings = %+v, want 3", headings)
	}
	if headings[0].Level != 1 || headings[0].Text != "Title" || headings[0].Slug != "title" {
		t.Fatalf("headings[0] = %+v", headings[0])
	}
	if headings[1].Level != 2 || headings[1].Slug != "section-one" {
		t.Fatalf("headings[1] = %+v", headings[1])
	}
	if headings[2].Level != 3 || headings[2].Slug != "sub-section" {
		t.Fatalf("headings[2] = %+v", headings[2])
	}
}

func TestExtractHeadings_NoHeadings(t *testing.T) {
	if got := ExtractHeadings("just some text"); len(got) != 0 {
		t.Fatalf("headings = %+v, want none", got)
	}
}
```

`internal/render/plantuml_test.go`:

```go
package render

import (
	"context"
	"strings"
	"testing"
)

func TestPlantUMLRenderer_UnavailableWhenNotConfigured(t *testing.T) {
	r := NewPlantUMLRenderer("", t.TempDir())
	if r.Available() {
		t.Fatal("expected Available() == false when jarPath is empty")
	}
	svg, reason := r.RenderSVG(context.Background(), "@startuml\nA -> B\n@enduml")
	if svg != "" || reason == "" {
		t.Fatalf("svg=%q reason=%q, want empty svg and a reason", svg, reason)
	}
}

func TestPlantUMLRenderer_RenderBlocks_UnavailableAddsNotice(t *testing.T) {
	r := NewPlantUMLRenderer("", t.TempDir())
	body := "before\n```plantuml\n@startuml\nA -> B\n@enduml\n```\nafter"
	out := r.RenderBlocks(context.Background(), body)
	if !strings.Contains(out, "@startuml") {
		t.Fatalf("expected raw plantuml source preserved, got: %s", out)
	}
	if !strings.Contains(out, "PlantUML rendering unavailable") {
		t.Fatalf("expected unavailable notice, got: %s", out)
	}
}

func TestCacheFileName_IsStableAndContentAddressed(t *testing.T) {
	a := cacheFileName("@startuml\nA -> B\n@enduml")
	b := cacheFileName("@startuml\nA -> B\n@enduml")
	c := cacheFileName("@startuml\nA -> C\n@enduml")
	if a != b {
		t.Fatalf("same content should hash to same cache filename: %q vs %q", a, b)
	}
	if a == c {
		t.Fatalf("different content should hash to different cache filenames")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=1 go test ./internal/render/...`
Expected: FAIL — `ExtractHeadings`, `NewPlantUMLRenderer` undefined.

- [ ] **Step 3: Write the implementation**

`internal/render/render.go`:

```go
package render

import "regexp"

type FileView struct {
	Path        string         `json:"path"`
	Title       string         `json:"title"`
	Frontmatter map[string]any `json:"frontmatter"`
	Body        string         `json:"body"`
	Headings    []Heading      `json:"headings"`
	IsAIContext bool           `json:"is_ai_context"`
}

type Heading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	Slug  string `json:"slug"`
}

var headingRe = regexp.MustCompile(`(?m)^(#{1,6})\s+(.+)$`)
var slugInvalidRe = regexp.MustCompile(`[^a-z0-9]+`)

func ExtractHeadings(body string) []Heading {
	matches := headingRe.FindAllStringSubmatch(body, -1)
	headings := make([]Heading, 0, len(matches))
	for _, m := range matches {
		text := trimSpace(m[2])
		headings = append(headings, Heading{Level: len(m[1]), Text: text, Slug: slugify(text)})
	}
	return headings
}

func slugify(s string) string {
	s = toLower(s)
	s = slugInvalidRe.ReplaceAllString(s, "-")
	return trimDashes(s)
}

func toLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + ('a' - 'A')
		}
	}
	return string(b)
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

func trimDashes(s string) string {
	start, end := 0, len(s)
	for start < end && s[start] == '-' {
		start++
	}
	for end > start && s[end-1] == '-' {
		end--
	}
	return s[start:end]
}
```

`internal/render/plantuml.go`:

```go
package render

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

type PlantUMLRenderer struct {
	jarPath  string
	cacheDir string
}

func NewPlantUMLRenderer(jarPath, cacheDir string) *PlantUMLRenderer {
	return &PlantUMLRenderer{jarPath: jarPath, cacheDir: cacheDir}
}

func (r *PlantUMLRenderer) Available() bool { return r.jarPath != "" }

func cacheFileName(src string) string {
	hash := sha256.Sum256([]byte(src))
	return hex.EncodeToString(hash[:]) + ".svg"
}

// RenderSVG renders PlantUML source to SVG, caching by content hash. If
// unavailableReason is non-empty, svg is empty and the caller should render
// the raw source with an inline notice instead (spec §5).
func (r *PlantUMLRenderer) RenderSVG(ctx context.Context, src string) (svg string, unavailableReason string) {
	if !r.Available() {
		return "", "no PlantUML renderer configured"
	}
	cachePath := filepath.Join(r.cacheDir, cacheFileName(src))
	if cached, err := os.ReadFile(cachePath); err == nil {
		return string(cached), ""
	}
	if _, err := exec.LookPath("java"); err != nil {
		return "", "java not found on PATH"
	}
	cmd := exec.CommandContext(ctx, "java", "-jar", r.jarPath, "-tsvg", "-pipe")
	cmd.Stdin = strings.NewReader(src)
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Sprintf("plantuml render failed: %v: %s", err, stderr.String())
	}
	_ = os.MkdirAll(r.cacheDir, 0o755)
	_ = os.WriteFile(cachePath, out.Bytes(), 0o644)
	return out.String(), ""
}

var plantumlBlockRe = regexp.MustCompile("(?s)```plantuml\\n(.*?)\\n```")

func (r *PlantUMLRenderer) RenderBlocks(ctx context.Context, body string) string {
	return plantumlBlockRe.ReplaceAllStringFunc(body, func(block string) string {
		m := plantumlBlockRe.FindStringSubmatch(block)
		src := m[1]
		svg, reason := r.RenderSVG(ctx, src)
		if reason != "" {
			return "```plantuml\n" + src + "\n```\n> ⚠️ PlantUML rendering unavailable: " + reason
		}
		encoded := base64.StdEncoding.EncodeToString([]byte(svg))
		return fmt.Sprintf(`<img alt="diagram" src="data:image/svg+xml;base64,%s" />`, encoded)
	})
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CGO_ENABLED=1 go test ./internal/render/...`
Expected: PASS. (Full jar-invocation rendering is not exercised in this suite since it requires a local `java` + `plantuml.jar` — the `Available()==false` degrade path above is what spec §5 actually requires to be correct; verify the jar path manually per Task 25's manual verification checklist if you have `plantuml.jar` installed.)

- [ ] **Step 5: Commit**

```bash
git add internal/render
git commit -m "feat(render): add heading extraction and PlantUML local renderer with cache + graceful degradation"
```

---
### Task 11: doctree package + App composition root

**Files:**
- Create: `internal/doctree/doctree.go`
- Create: `internal/doctree/doctree_test.go`
- Create: `internal/app/app.go`
- Create: `internal/app/app_test.go`

**Interfaces:**
- Consumes: `source.Source`, `source.NewLocalSource`, `source.NewGitSource` (Tasks 3-4); `store.Open` (Task 5); `index.New`, `(*Indexer).IndexSource` (Task 6); `search.New`, `(*Service).SetVectorSearch`, `search.NewVectorStore`, `(*VectorStore).EnsureSchema` (Tasks 7, 9); `gitsvc.New` (Task 8); `render.NewPlantUMLRenderer` (Task 10); `embedprovider.NewOpenAIProvider` (Task 9); `config.Config` (Task 1).
- Produces: `doctree.TreeNode{Name, Path, IsDir, Children}`, `doctree.Insert(root *TreeNode, sourceID, relPath string)`, `doctree.SplitSourcePath(path string) (sourceID, relPath string, err error)`, `doctree.Build(ctx, rootName string, sourceIDs []string, sources map[string]source.Source) (TreeNode, error)`, `doctree.CollectLeaves(node TreeNode, out *[]string)`; `app.App{Cfg, Store, Indexer, Search, Git, PlantUML, Workspaces}`, `app.Workspace{Cfg, Sources}`, `(*Workspace).SourceIDs() []string`, `app.New(cfg *config.Config) (*App, error)`, `(*App).Workspace(id string) (*Workspace, bool)`, `(*App).SyncAndIndexAll(ctx, failFast bool) error`, `(*App).Close() error`.

- [ ] **Step 1: Write the failing tests**

`internal/doctree/doctree_test.go`:

```go
package doctree

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/source"
)

func TestBuild_MergesMultipleSourcesIntoOneTree(t *testing.T) {
	dirA := t.TempDir()
	dirB := t.TempDir()
	mustWrite(t, filepath.Join(dirA, "guide.md"), "a")
	mustWrite(t, filepath.Join(dirB, "sub", "other.md"), "b")

	sources := map[string]source.Source{
		"a": source.NewLocalSource("a", dirA),
		"b": source.NewLocalSource("b", dirB),
	}
	tree, err := Build(context.Background(), "Workspace", []string{"a", "b"}, sources)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if len(tree.Children) != 2 {
		t.Fatalf("root children = %+v, want 2 mount points", tree.Children)
	}
	var leaves []string
	CollectLeaves(tree, &leaves)
	if len(leaves) != 2 {
		t.Fatalf("leaves = %+v, want 2", leaves)
	}
	found := map[string]bool{}
	for _, l := range leaves {
		found[l] = true
	}
	if !found["a/guide.md"] || !found["b/sub/other.md"] {
		t.Fatalf("leaves = %+v", leaves)
	}
}

func TestSplitSourcePath(t *testing.T) {
	sourceID, relPath, err := SplitSourcePath("local/guide.md")
	if err != nil || sourceID != "local" || relPath != "guide.md" {
		t.Fatalf("got %q %q %v", sourceID, relPath, err)
	}
	if _, _, err := SplitSourcePath("no-slash"); err == nil {
		t.Fatal("expected error for path missing source prefix")
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := writeFile(path, content); err != nil {
		t.Fatal(err)
	}
}
```

`internal/doctree/testutil_test.go`:

```go
package doctree

import (
	"os"
	"path/filepath"
)

func writeFile(path, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o644)
}
```

`internal/app/app_test.go`:

```go
package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/config"
)

func TestApp_New_WiresWorkspacesAndSources(t *testing.T) {
	docsDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(docsDir, "guide.md"), []byte("# Guide"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		DataDir: t.TempDir(),
		Server:  config.ServerConfig{Addr: ":0"},
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{
				{ID: "local", Type: "local", Path: docsDir},
			}},
		},
	}
	a, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer a.Close()

	ws, ok := a.Workspace("ws")
	if !ok {
		t.Fatal("workspace ws not found")
	}
	if len(ws.Sources) != 1 {
		t.Fatalf("sources = %+v", ws.Sources)
	}
	if got := ws.SourceIDs(); len(got) != 1 || got[0] != "local" {
		t.Fatalf("SourceIDs = %+v", got)
	}
}

func TestApp_SyncAndIndexAll_IndexesFiles(t *testing.T) {
	docsDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(docsDir, "guide.md"), []byte("# Guide\nhello"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		DataDir: t.TempDir(),
		Server:  config.ServerConfig{Addr: ":0"},
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{
				{ID: "local", Type: "local", Path: docsDir},
			}},
		},
	}
	a, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer a.Close()

	if err := a.SyncAndIndexAll(context.Background(), true); err != nil {
		t.Fatalf("SyncAndIndexAll: %v", err)
	}
	var count int
	if err := a.Store.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE workspace_id='ws'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("indexed row count = %d, want 1", count)
	}
}

func TestApp_New_RejectsUnknownSourceType(t *testing.T) {
	cfg := &config.Config{
		DataDir: t.TempDir(),
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{
				{ID: "s", Type: "ftp", Path: "/x"},
			}},
		},
	}
	if _, err := New(cfg); err == nil {
		t.Fatal("expected error for unknown source type")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/doctree/... ./internal/app/...`
Expected: FAIL — packages do not compile.

- [ ] **Step 3: Write the implementation**

`internal/doctree/doctree.go`:

```go
package doctree

import (
	"context"
	"fmt"
	"strings"

	"github.com/tuannm99/dmox/internal/source"
)

type TreeNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	IsDir    bool       `json:"is_dir"`
	Children []TreeNode `json:"children,omitempty"`
}

func Insert(root *TreeNode, sourceID, relPath string) {
	parts := strings.Split(relPath, "/")
	cur := root
	for i, part := range parts {
		isDir := i < len(parts)-1
		var next *TreeNode
		for idx := range cur.Children {
			if cur.Children[idx].Name == part {
				next = &cur.Children[idx]
				break
			}
		}
		if next == nil {
			cur.Children = append(cur.Children, TreeNode{
				Name: part, Path: sourceID + "/" + strings.Join(parts[:i+1], "/"), IsDir: isDir,
			})
			next = &cur.Children[len(cur.Children)-1]
		}
		cur = next
	}
}

func SplitSourcePath(path string) (sourceID, relPath string, err error) {
	idx := strings.Index(path, "/")
	if idx < 0 {
		return "", "", fmt.Errorf("path %q missing source prefix", path)
	}
	return path[:idx], path[idx+1:], nil
}

// Build merges every source in a workspace into one tree, mounted by source ID.
// A source that fails to List() is skipped rather than failing the whole tree
// (spec §5: the rest of the workspace keeps functioning off the last-known-good index).
func Build(ctx context.Context, rootName string, sourceIDs []string, sources map[string]source.Source) (TreeNode, error) {
	root := TreeNode{Name: rootName, Path: "", IsDir: true}
	for _, sid := range sourceIDs {
		src := sources[sid]
		files, err := src.List(ctx)
		if err != nil {
			continue
		}
		mount := TreeNode{Name: sid, Path: sid, IsDir: true}
		for _, f := range files {
			Insert(&mount, sid, f.Path)
		}
		root.Children = append(root.Children, mount)
	}
	return root, nil
}

func CollectLeaves(node TreeNode, out *[]string) {
	if !node.IsDir {
		*out = append(*out, node.Path)
		return
	}
	for _, c := range node.Children {
		CollectLeaves(c, out)
	}
}
```

`internal/app/app.go`:

```go
package app

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/tuannm99/dmox/internal/config"
	"github.com/tuannm99/dmox/internal/embedprovider"
	"github.com/tuannm99/dmox/internal/gitsvc"
	"github.com/tuannm99/dmox/internal/index"
	"github.com/tuannm99/dmox/internal/render"
	"github.com/tuannm99/dmox/internal/search"
	"github.com/tuannm99/dmox/internal/source"
	"github.com/tuannm99/dmox/internal/store"
)

type Workspace struct {
	Cfg     config.Workspace
	Sources map[string]source.Source
}

func (w *Workspace) SourceIDs() []string {
	ids := make([]string, len(w.Cfg.Sources))
	for i, s := range w.Cfg.Sources {
		ids[i] = s.ID
	}
	return ids
}

type App struct {
	Cfg        *config.Config
	Store      *store.Store
	Indexer    *index.Indexer
	Search     *search.Service
	Git        *gitsvc.Service
	PlantUML   *render.PlantUMLRenderer
	Workspaces map[string]*Workspace
}

func New(cfg *config.Config) (*App, error) {
	dbPath := filepath.Join(cfg.DataDir, "dmox.db")
	st, err := store.Open(dbPath)
	if err != nil {
		return nil, err
	}

	a := &App{
		Cfg:      cfg,
		Store:    st,
		Indexer:  index.New(st),
		Search:   search.New(st),
		Git:      gitsvc.New(),
		PlantUML: render.NewPlantUMLRenderer(cfg.Render.PlantUML.JarPath, filepath.Join(cfg.DataDir, "plantuml-cache")),
		Workspaces: map[string]*Workspace{},
	}

	for _, wcfg := range cfg.Workspaces {
		ws := &Workspace{Cfg: wcfg, Sources: map[string]source.Source{}}
		for _, scfg := range wcfg.Sources {
			switch scfg.Type {
			case "local":
				ws.Sources[scfg.ID] = source.NewLocalSource(scfg.ID, scfg.Path)
			case "git":
				ws.Sources[scfg.ID] = source.NewGitSource(scfg.ID, scfg.URL, scfg.Branch, cfg.DataDir)
			default:
				st.Close()
				return nil, fmt.Errorf("workspace %s source %s: unknown type %q", wcfg.ID, scfg.ID, scfg.Type)
			}
		}
		a.Workspaces[wcfg.ID] = ws
	}

	if cfg.Embeddings.Provider == "openai" {
		vs := search.NewVectorStore(st)
		if err := vs.EnsureSchema(context.Background()); err != nil {
			st.Close()
			return nil, err
		}
		provider := embedprovider.NewOpenAIProvider(os.Getenv(cfg.Embeddings.APIKeyEnv), cfg.Embeddings.Model)
		a.Search.SetVectorSearch(vs, provider)
	}

	return a, nil
}

func (a *App) Workspace(id string) (*Workspace, bool) {
	ws, ok := a.Workspaces[id]
	return ws, ok
}

// SyncAndIndexAll syncs and indexes every source in every workspace. When
// failFast is true (dmox build), the first error aborts; when false (dmox
// serve startup), errors are logged and the source keeps its last-known-good
// index (spec §5).
func (a *App) SyncAndIndexAll(ctx context.Context, failFast bool) error {
	for wsID, ws := range a.Workspaces {
		for _, src := range ws.Sources {
			if err := src.Sync(ctx); err != nil {
				if failFast {
					return fmt.Errorf("sync %s/%s: %w", wsID, src.ID(), err)
				}
				log.Printf("sync %s/%s failed, using last-known-good index: %v", wsID, src.ID(), err)
				continue
			}
			if err := a.Indexer.IndexSource(ctx, wsID, src); err != nil {
				if failFast {
					return fmt.Errorf("index %s/%s: %w", wsID, src.ID(), err)
				}
				log.Printf("index %s/%s failed: %v", wsID, src.ID(), err)
			}
		}
	}
	return nil
}

func (a *App) Close() error { return a.Store.Close() }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/doctree/... ./internal/app/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/doctree internal/app
git commit -m "feat(app): add doctree package and App composition root wiring all services"
```

---

### Task 12: Gin API — workspaces/tree/file endpoints, CORS

**Files:**
- Create: `internal/api/server.go`
- Create: `internal/api/workspace_handlers.go`
- Create: `internal/api/server_test.go`
- Modify: `go.mod` (add `gin-gonic/gin`)

**Interfaces:**
- Consumes: `app.App`, `(*App).Workspace`, `doctree.Build`, `doctree.SplitSourcePath`, `index.Parse`, `index.IsAIContextFile`, `render.FileView`, `render.ExtractHeadings`, `(*render.PlantUMLRenderer).RenderBlocks`.
- Produces: `api.NewRouter(a *app.App) *gin.Engine`.

- [ ] **Step 1: Write the failing test**

```bash
go get github.com/gin-gonic/gin
```

`internal/api/server_test.go`:

```go
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/config"
	"github.com/tuannm99/dmox/internal/doctree"
)

func newTestApp(t *testing.T) *app.App {
	t.Helper()
	docsDir := t.TempDir()
	mustWrite(t, filepath.Join(docsDir, "guide.md"), "---\ntitle: My Guide\n---\n# My Guide\nhello world getting started")
	mustWrite(t, filepath.Join(docsDir, "CLAUDE.md"), "agent instructions")
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Server:     config.ServerConfig{Addr: ":0"},
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{
				{ID: "local", Type: "local", Path: docsDir},
			}},
		},
	}
	a, err := app.New(cfg)
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	t.Cleanup(func() { a.Close() })
	if err := a.SyncAndIndexAll(context.Background(), true); err != nil {
		t.Fatalf("SyncAndIndexAll: %v", err)
	}
	return a
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestAPI_ListWorkspaces(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out []map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	if len(out) != 1 || out[0]["id"] != "ws" {
		t.Fatalf("workspaces = %+v", out)
	}
}

func TestAPI_Tree(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/tree")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var tree doctree.TreeNode
	json.NewDecoder(resp.Body).Decode(&tree)
	var leaves []string
	doctree.CollectLeaves(tree, &leaves)
	if len(leaves) != 2 {
		t.Fatalf("leaves = %+v, want 2", leaves)
	}
}

func TestAPI_Tree_UnknownWorkspace(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()
	resp, _ := http.Get(srv.URL + "/api/workspaces/nope/tree")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestAPI_File(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/file?path=local/guide.md")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var fv map[string]any
	json.NewDecoder(resp.Body).Decode(&fv)
	if fv["title"] != "My Guide" {
		t.Fatalf("title = %v", fv["title"])
	}
	if fv["is_ai_context"] != false {
		t.Fatalf("is_ai_context = %v, want false", fv["is_ai_context"])
	}
}

func TestAPI_File_AIContextFlag(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, _ := http.Get(srv.URL + "/api/workspaces/ws/file?path=local/CLAUDE.md")
	defer resp.Body.Close()
	var fv map[string]any
	json.NewDecoder(resp.Body).Decode(&fv)
	if fv["is_ai_context"] != true {
		t.Fatalf("is_ai_context = %v, want true", fv["is_ai_context"])
	}
}

func TestAPI_CORSHeaders(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()
	resp, _ := http.Get(srv.URL + "/api/workspaces")
	if resp.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("missing CORS header")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/api/...`
Expected: FAIL — `NewRouter` undefined.

- [ ] **Step 3: Write the implementation**

`internal/api/server.go`:

```go
package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/app"
)

func NewRouter(a *app.App) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery(), gin.Logger(), corsMiddleware())
	g := r.Group("/api")
	g.GET("/workspaces", handleListWorkspaces(a))
	g.GET("/workspaces/:id/tree", handleTree(a))
	g.GET("/workspaces/:id/file", handleFile(a))
	g.GET("/workspaces/:id/search", handleSearch(a))
	g.GET("/workspaces/:id/ai-context", handleAIContext(a))
	g.GET("/workspaces/:id/git/history", handleGitHistory(a))
	g.GET("/workspaces/:id/git/blame", handleGitBlame(a))
	g.POST("/sources/:id/pull", handleSourcePull(a))
	return r
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
```

`internal/api/workspace_handlers.go`:

```go
package api

import (
	"net/http"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/doctree"
	"github.com/tuannm99/dmox/internal/index"
	"github.com/tuannm99/dmox/internal/render"
)

func handleListWorkspaces(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		out := make([]gin.H, 0, len(a.Cfg.Workspaces))
		for _, w := range a.Cfg.Workspaces {
			out = append(out, gin.H{"id": w.ID, "name": w.Name})
		}
		c.JSON(http.StatusOK, out)
	}
}

func handleTree(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		ws, ok := a.Workspace(c.Param("id"))
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		tree, err := doctree.Build(c.Request.Context(), ws.Cfg.Name, ws.SourceIDs(), ws.Sources)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, tree)
	}
}

func handleFile(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		ws, ok := a.Workspace(c.Param("id"))
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		path := c.Query("path")
		sourceID, relPath, err := doctree.SplitSourcePath(path)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		src, ok := ws.Sources[sourceID]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "source not found"})
			return
		}
		raw, err := src.Read(c.Request.Context(), relPath)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		doc := index.Parse(raw, filepath.Base(relPath))
		body := a.PlantUML.RenderBlocks(c.Request.Context(), doc.Body)
		c.JSON(http.StatusOK, render.FileView{
			Path: path, Title: doc.Title, Frontmatter: doc.Frontmatter, Body: body,
			Headings: render.ExtractHeadings(doc.Body), IsAIContext: index.IsAIContextFile(relPath),
		})
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/api/... -run 'TestAPI_ListWorkspaces|TestAPI_Tree|TestAPI_File|TestAPI_CORS'`
Expected: PASS. (`handleSearch`, `handleAIContext`, `handleGitHistory`, `handleGitBlame`, `handleSourcePull` referenced in `server.go` are added in Task 13 — add stub handlers returning `c.JSON(http.StatusNotImplemented, gin.H{})` in this task if you want `go build` to succeed before Task 13 lands, or implement Tasks 12 and 13 back-to-back in the same sitting.)

- [ ] **Step 5: Commit**

```bash
git add go.mod go.sum internal/api/server.go internal/api/workspace_handlers.go internal/api/server_test.go
git commit -m "feat(api): add Gin router with workspaces/tree/file endpoints and permissive CORS"
```

---

### Task 13: Gin API — search/ai-context/git/pull endpoints

**Files:**
- Create: `internal/api/search_handlers.go`
- Create: `internal/api/git_handlers.go`
- Modify: `internal/api/server_test.go` (append tests)

**Interfaces:**
- Consumes: `(*app.App).Search.Search`, `(*app.App).Store.DB()`, `(*app.App).Git.History`/`Blame`, `source.GitSource`, `(*GitSource).MirrorDir()`, `(*app.App).Indexer.IndexSource`.
- Produces: `handleSearch`, `handleAIContext`, `handleGitHistory`, `handleGitBlame`, `handleSourcePull` (referenced by `server.go` from Task 12).

- [ ] **Step 1: Write the failing tests**

Append to `internal/api/server_test.go`:

```go
func TestAPI_Search(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/search?q=getting+started")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var results []map[string]any
	json.NewDecoder(resp.Body).Decode(&results)
	if len(results) != 1 || results[0]["path"] != "guide.md" {
		t.Fatalf("results = %+v", results)
	}
}

func TestAPI_AIContext(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/ai-context")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var entries []map[string]any
	json.NewDecoder(resp.Body).Decode(&entries)
	if len(entries) != 1 || entries[0]["path"] != "CLAUDE.md" {
		t.Fatalf("entries = %+v", entries)
	}
}

func TestAPI_GitHistory_NotApplicableForLocalSource(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/git/history?path=local/guide.md")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	if out["applicable"] != false {
		t.Fatalf("applicable = %v, want false for a local source", out["applicable"])
	}
}

func TestAPI_GitBlame_NotApplicableForLocalSource(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/git/blame?path=local/guide.md")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	if out["applicable"] != false {
		t.Fatalf("applicable = %v, want false for a local source", out["applicable"])
	}
}

func TestAPI_SourcePull_ResyncsAndReindexes(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/api/sources/local/pull", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestAPI_SourcePull_UnknownSource(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, _ := http.Post(srv.URL+"/api/sources/nope/pull", "application/json", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/api/...`
Expected: FAIL — `handleSearch` etc. undefined (or `go build` failure if Task 12 left no stubs).

- [ ] **Step 3: Write the implementation**

`internal/api/search_handlers.go`:

```go
package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/app"
)

func handleSearch(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := a.Workspace(c.Param("id")); !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		results, err := a.Search.Search(c.Request.Context(), c.Param("id"), c.Query("q"), 20)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if results == nil {
			results = []any{}
		}
		c.JSON(http.StatusOK, results)
	}
}

func handleAIContext(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := a.Workspace(c.Param("id")); !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		rows, err := a.Store.DB().QueryContext(c.Request.Context(),
			`SELECT source_id, path, title FROM files WHERE workspace_id=? AND is_ai_context=1 ORDER BY source_id, path`,
			c.Param("id"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		type entry struct{ SourceID, Path, Title string }
		out := []entry{}
		for rows.Next() {
			var e entry
			if err := rows.Scan(&e.SourceID, &e.Path, &e.Title); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			out = append(out, e)
		}
		c.JSON(http.StatusOK, out)
	}
}
```

`internal/api/git_handlers.go`:

```go
package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/doctree"
	"github.com/tuannm99/dmox/internal/gitsvc"
	"github.com/tuannm99/dmox/internal/source"
)

func handleGitHistory(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		ws, ok := a.Workspace(c.Param("id"))
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		sourceID, relPath, err := doctree.SplitSourcePath(c.Query("path"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		src, ok := ws.Sources[sourceID]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "source not found"})
			return
		}
		gitSrc, ok := src.(*source.GitSource)
		if !ok {
			c.JSON(http.StatusOK, gin.H{"applicable": false, "commits": []gitsvc.Commit{}})
			return
		}
		commits, err := a.Git.History(gitSrc.MirrorDir(), relPath, 50)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"applicable": true, "commits": commits})
	}
}

func handleGitBlame(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		ws, ok := a.Workspace(c.Param("id"))
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		sourceID, relPath, err := doctree.SplitSourcePath(c.Query("path"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		src, ok := ws.Sources[sourceID]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "source not found"})
			return
		}
		gitSrc, ok := src.(*source.GitSource)
		if !ok {
			c.JSON(http.StatusOK, gin.H{"applicable": false, "lines": []gitsvc.BlameLine{}})
			return
		}
		lines, err := a.Git.Blame(gitSrc.MirrorDir(), relPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"applicable": true, "lines": lines})
	}
}

func handleSourcePull(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		sourceID := c.Param("id")
		for wsID, ws := range a.Workspaces {
			src, ok := ws.Sources[sourceID]
			if !ok {
				continue
			}
			if err := src.Sync(c.Request.Context()); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := a.Indexer.IndexSource(c.Request.Context(), wsID, src); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "ok"})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "source not found"})
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/api/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/api
git commit -m "feat(api): add search, ai-context, git history/blame, and source-pull endpoints"
```

---

### Task 14: `dmox serve` command (startup sync, fsnotify wiring, HTTP server)

**Files:**
- Create: `cmd/dmox/main.go`
- Create: `cmd/dmox/serve.go`
- Create: `cmd/dmox/serve_test.go`

**Interfaces:**
- Consumes: `config.Load`, `app.New`, `(*App).SyncAndIndexAll`, `api.NewRouter`, `source.Source.Watch`, `(*Indexer).IndexFile`.
- Produces: `main()` subcommand dispatch (`serve`, `build`, `tree`, `context`), `runServe(cfg *config.Config) error`, `watchAndReindex(ctx, a, wsID, src, events)`.

- [ ] **Step 1: Write the failing test**

`cmd/dmox/serve_test.go`:

```go
package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/config"
	"github.com/tuannm99/dmox/internal/source"
)

func TestWatchAndReindex_ProcessesEventsThenExitsOnChannelClose(t *testing.T) {
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
	events := make(chan source.ChangeEvent, 1)
	events <- source.ChangeEvent{Path: "guide.md", Op: source.ChangeOpModify}
	close(events)

	watchAndReindex(context.Background(), a, "ws", src, events)

	var count int
	if err := a.Store.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE path='guide.md'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected guide.md indexed after watch event, count=%d", count)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./cmd/dmox/...`
Expected: FAIL — `watchAndReindex` undefined.

- [ ] **Step 3: Write the implementation**

`cmd/dmox/main.go`:

```go
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/tuannm99/dmox/internal/config"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}
	switch os.Args[1] {
	case "serve":
		cfg := mustLoadConfig()
		if err := runServe(cfg); err != nil {
			log.Fatal(err)
		}
	case "build":
		runBuildCmd(os.Args[2:])
	case "tree":
		runTreeCmd(os.Args[2:])
	case "context":
		runContextCmd(os.Args[2:])
	default:
		printUsage()
		os.Exit(1)
	}
}

func mustLoadConfig() *config.Config {
	path := os.Getenv("DMOX_CONFIG")
	if path == "" {
		path = "config.yaml"
	}
	cfg, err := config.Load(path)
	if err != nil {
		log.Fatalf("dmox: %v", err)
	}
	return cfg
}

func printUsage() {
	fmt.Fprintln(os.Stderr, `dmox - Engineering Knowledge Platform

Usage:
  dmox serve                              Start the local server (web UI + REST API)
  dmox build --workspace ID --out DIR     Produce a static export
  dmox tree --workspace ID [--format text|json]
  dmox context --workspace ID [--filter ai|all]`)
}
```

`cmd/dmox/serve.go`:

```go
package main

import (
	"context"
	"log"
	"net/http"

	"github.com/tuannm99/dmox/internal/api"
	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/config"
	"github.com/tuannm99/dmox/internal/source"
)

func runServe(cfg *config.Config) error {
	a, err := app.New(cfg)
	if err != nil {
		return err
	}
	defer a.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := a.SyncAndIndexAll(ctx, false); err != nil {
		log.Printf("startup sync had errors: %v", err)
	}

	for wsID, ws := range a.Workspaces {
		for _, src := range ws.Sources {
			events, err := src.Watch(ctx)
			if err != nil {
				log.Printf("watch %s/%s failed: %v", wsID, src.ID(), err)
				continue
			}
			if events == nil {
				continue
			}
			go watchAndReindex(ctx, a, wsID, src, events)
		}
	}

	router := api.NewRouter(a)
	if err := mountFrontend(router); err != nil {
		log.Printf("frontend assets unavailable, API-only mode: %v", err)
	}
	srv := &http.Server{Addr: cfg.Server.Addr, Handler: router}
	log.Printf("dmox serving on %s", cfg.Server.Addr)
	return srv.ListenAndServe()
}

func watchAndReindex(ctx context.Context, a *app.App, wsID string, src source.Source, events <-chan source.ChangeEvent) {
	for ev := range events {
		if err := a.Indexer.IndexFile(ctx, wsID, src, ev.Path); err != nil {
			log.Printf("reindex %s/%s/%s failed: %v", wsID, src.ID(), ev.Path, err)
		}
	}
}
```

Note: `mountFrontend` is added in Task 22 (embedding). For this task, add a temporary no-op so `serve.go` compiles:

`cmd/dmox/frontend_stub.go` (deleted and replaced in Task 22):

```go
package main

import "github.com/gin-gonic/gin"

func mountFrontend(r *gin.Engine) error { return nil }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./cmd/dmox/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cmd/dmox/main.go cmd/dmox/serve.go cmd/dmox/serve_test.go cmd/dmox/frontend_stub.go
git commit -m "feat(cli): add dmox serve with startup sync and fsnotify-driven reindexing"
```

---

### Task 15: CLI — `dmox tree` and `dmox context`

**Files:**
- Create: `cmd/dmox/client.go`
- Create: `cmd/dmox/tree.go`
- Create: `cmd/dmox/context.go`
- Create: `cmd/dmox/tree_test.go`
- Create: `cmd/dmox/context_test.go`

**Interfaces:**
- Consumes: `doctree.TreeNode`, `render.FileView` (JSON shapes returned by the REST API from Tasks 12-13).
- Produces: `apiGet(path string, out any) error`, `runTreeCmd(args []string)`, `runContextCmd(args []string)`, `printTreeText`, `collectLeaves`.

- [ ] **Step 1: Write the failing tests**

`cmd/dmox/tree_test.go`:

```go
package main

import (
	"bytes"
	"testing"

	"github.com/tuannm99/dmox/internal/doctree"
)

func TestPrintTreeText(t *testing.T) {
	tree := doctree.TreeNode{
		Name: "WS", IsDir: true,
		Children: []doctree.TreeNode{
			{Name: "local", IsDir: true, Children: []doctree.TreeNode{
				{Name: "guide.md", Path: "local/guide.md", IsDir: false},
			}},
		},
	}
	var buf bytes.Buffer
	printTreeText(&buf, tree, 0)
	got := buf.String()
	if !bytes.Contains([]byte(got), []byte("local")) || !bytes.Contains([]byte(got), []byte("guide.md")) {
		t.Fatalf("output = %q", got)
	}
}
```

`cmd/dmox/context_test.go`:

```go
package main

import (
	"testing"

	"github.com/tuannm99/dmox/internal/doctree"
)

func TestCollectLeaves(t *testing.T) {
	tree := doctree.TreeNode{
		IsDir: true,
		Children: []doctree.TreeNode{
			{Name: "a.md", Path: "local/a.md", IsDir: false},
			{Name: "dir", IsDir: true, Children: []doctree.TreeNode{
				{Name: "b.md", Path: "local/dir/b.md", IsDir: false},
			}},
		},
	}
	var out []string
	collectLeaves(tree, &out)
	if len(out) != 2 {
		t.Fatalf("leaves = %+v, want 2", out)
	}
}
```

`cmd/dmox/client_test.go`:

```go
package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestApiGet_DecodesJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ok": true}`))
	}))
	defer srv.Close()
	os.Setenv("DMOX_API_URL", srv.URL)
	defer os.Unsetenv("DMOX_API_URL")

	var out struct {
		OK bool `json:"ok"`
	}
	if err := apiGet("/anything", &out); err != nil {
		t.Fatalf("apiGet: %v", err)
	}
	if !out.OK {
		t.Fatal("expected ok=true")
	}
}

func TestApiGet_ErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("not found"))
	}))
	defer srv.Close()
	os.Setenv("DMOX_API_URL", srv.URL)
	defer os.Unsetenv("DMOX_API_URL")

	var out struct{}
	if err := apiGet("/x", &out); err == nil {
		t.Fatal("expected error for 404 response")
	}
}

func TestApiGet_ConnectionRefused(t *testing.T) {
	os.Setenv("DMOX_API_URL", "http://127.0.0.1:1")
	defer os.Unsetenv("DMOX_API_URL")
	var out struct{}
	err := apiGet("/x", &out)
	if err == nil {
		t.Fatal("expected connection error")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./cmd/dmox/... -run 'TestPrintTreeText|TestCollectLeaves|TestApiGet'`
Expected: FAIL — `printTreeText`, `collectLeaves`, `apiGet` undefined.

- [ ] **Step 3: Write the implementation**

`cmd/dmox/client.go`:

```go
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

func apiBaseURL() string {
	if v := os.Getenv("DMOX_API_URL"); v != "" {
		return v
	}
	return "http://localhost:8080"
}

func apiGet(path string, out any) error {
	resp, err := http.Get(apiBaseURL() + path)
	if err != nil {
		return fmt.Errorf("dmox: cannot reach dmox server at %s (is `dmox serve` running?): %w", apiBaseURL(), err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("dmox: api error %d: %s", resp.StatusCode, string(b))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
```

`cmd/dmox/tree.go`:

```go
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"strings"

	"github.com/tuannm99/dmox/internal/doctree"
)

func runTreeCmd(args []string) {
	fs := flag.NewFlagSet("tree", flag.ExitOnError)
	workspace := fs.String("workspace", "", "workspace id")
	format := fs.String("format", "text", "output format: text|json")
	fs.Parse(args)
	if *workspace == "" {
		log.Fatal("dmox tree: --workspace is required")
	}
	var root doctree.TreeNode
	if err := apiGet("/api/workspaces/"+*workspace+"/tree", &root); err != nil {
		log.Fatal(err)
	}
	switch *format {
	case "json":
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		enc.Encode(root)
	default:
		printTreeText(os.Stdout, root, 0)
	}
}

func printTreeText(w io.Writer, node doctree.TreeNode, depth int) {
	if depth > 0 {
		fmt.Fprintf(w, "%s%s\n", strings.Repeat("  ", depth-1), node.Name)
	}
	for _, c := range node.Children {
		printTreeText(w, c, depth+1)
	}
}
```

`cmd/dmox/context.go`:

```go
package main

import (
	"flag"
	"fmt"
	"log"
	"net/url"

	"github.com/tuannm99/dmox/internal/doctree"
	"github.com/tuannm99/dmox/internal/render"
)

func runContextCmd(args []string) {
	fs := flag.NewFlagSet("context", flag.ExitOnError)
	workspace := fs.String("workspace", "", "workspace id")
	filter := fs.String("filter", "ai", "ai|all")
	fs.Parse(args)
	if *workspace == "" {
		log.Fatal("dmox context: --workspace is required")
	}

	var targets []string
	switch *filter {
	case "all":
		var root doctree.TreeNode
		if err := apiGet("/api/workspaces/"+*workspace+"/tree", &root); err != nil {
			log.Fatal(err)
		}
		collectLeaves(root, &targets)
	default:
		var entries []struct{ SourceID, Path, Title string }
		if err := apiGet("/api/workspaces/"+*workspace+"/ai-context", &entries); err != nil {
			log.Fatal(err)
		}
		for _, e := range entries {
			targets = append(targets, e.SourceID+"/"+e.Path)
		}
	}

	for _, t := range targets {
		var fv render.FileView
		if err := apiGet("/api/workspaces/"+*workspace+"/file?path="+url.QueryEscape(t), &fv); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("\n---\n# %s (%s)\n\n%s\n", fv.Title, fv.Path, fv.Body)
	}
}

func collectLeaves(node doctree.TreeNode, out *[]string) {
	if !node.IsDir {
		*out = append(*out, node.Path)
		return
	}
	for _, c := range node.Children {
		collectLeaves(c, out)
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./cmd/dmox/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cmd/dmox/client.go cmd/dmox/tree.go cmd/dmox/context.go cmd/dmox/tree_test.go cmd/dmox/context_test.go cmd/dmox/client_test.go
git commit -m "feat(cli): add dmox tree and dmox context HTTP-client subcommands"
```

---
### Task 16: Frontend scaffold + DataSource abstraction (live + static)

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/datasource/types.ts`
- Create: `web/src/datasource/liveDataSource.ts`
- Create: `web/src/datasource/staticDataSource.ts`
- Create: `web/src/datasource/context.tsx`
- Create: `web/src/datasource/liveDataSource.test.ts`
- Create: `web/src/datasource/staticDataSource.test.ts`
- Create: `web/src/vite-env.d.ts`

**Interfaces:**
- Produces: `DataSource` interface and `TreeNode`, `FileView`, `SearchResult`, `AIContextEntry`, `Commit`, `BlameLine`, `Workspace` types (mirroring the Go JSON shapes from Tasks 10-13); `createLiveDataSource(baseURL?)`, `createStaticDataSource(basePath?)`, `resolveDataSource()`, `DataSourceProvider`, `useDataSource()`.

- [ ] **Step 1: Scaffold the project and write the failing tests**

```bash
cd /home/minhtuan/dev/local/dmox
mkdir -p web
```

`web/package.json`:

```json
{
  "name": "dmox-web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "react-markdown": "^9.0.1",
    "remark-gfm": "^4.0.0",
    "rehype-raw": "^7.0.0",
    "mermaid": "^11.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.47.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.3",
    "vitest": "^2.0.5"
  }
}
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

`web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/__DMOX_BASE__/',
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
  },
});
```

`web/src/setupTests.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DMOX</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`web/src/datasource/liveDataSource.test.ts`:

```ts
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
```

`web/src/datasource/staticDataSource.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStaticDataSource } from './staticDataSource';

describe('createStaticDataSource', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('reads the file JSON from a path-encoded location under the base path', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ path: 'local/a.md' }) });
    const ds = createStaticDataSource('/base/');
    await ds.getFile('ws', 'local/a.md');
    expect(global.fetch).toHaveBeenCalledWith('/base/data/files/local/a.md.json');
  });

  it('filters the pre-built search index client-side', async () => {
    (global.fetch as any).mockResolvedValue({
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
```

- [ ] **Step 2: Install dependencies and run the tests to verify they fail**

```bash
cd web && npm install
npx vitest run
```

Expected: FAIL — `./liveDataSource` and `./staticDataSource` modules don't exist yet.

- [ ] **Step 3: Write the implementation**

`web/src/datasource/types.ts`:

```ts
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

export interface DataSource {
  listWorkspaces(): Promise<Workspace[]>;
  getTree(workspaceId: string): Promise<TreeNode>;
  getFile(workspaceId: string, path: string): Promise<FileView>;
  search(workspaceId: string, query: string): Promise<SearchResult[]>;
  getAIContext(workspaceId: string): Promise<AIContextEntry[]>;
  getGitHistory(workspaceId: string, path: string): Promise<GitHistoryResult>;
  getGitBlame(workspaceId: string, path: string): Promise<GitBlameResult>;
}
```

`web/src/datasource/liveDataSource.ts`:

```ts
import type {
  DataSource, TreeNode, FileView, SearchResult, AIContextEntry, Workspace,
  GitHistoryResult, GitBlameResult,
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
  };
}
```

`web/src/datasource/staticDataSource.ts`:

```ts
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
```

`web/src/datasource/context.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { DataSource } from './types';
import { createLiveDataSource } from './liveDataSource';
import { createStaticDataSource } from './staticDataSource';

const DataSourceContext = createContext<DataSource | null>(null);

export function resolveDataSource(): DataSource {
  const mode = import.meta.env.VITE_DATA_SOURCE ?? 'live';
  return mode === 'static' ? createStaticDataSource() : createLiveDataSource();
}

export function DataSourceProvider({ children }: { children: ReactNode }) {
  return <DataSourceContext.Provider value={resolveDataSource()}>{children}</DataSourceContext.Provider>;
}

export function useDataSource(): DataSource {
  const ds = useContext(DataSourceContext);
  if (!ds) throw new Error('useDataSource must be used within DataSourceProvider');
  return ds;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts web/index.html web/src/datasource web/src/vite-env.d.ts web/src/setupTests.ts
git commit -m "feat(web): scaffold Vite/React SPA and DataSource abstraction (live + static)"
```

---

### Task 17: Routing shell + WorkspaceLayout + TreeView

**Files:**
- Create: `web/src/components/TreeView.tsx`
- Create: `web/src/components/TreeView.test.tsx`
- Create: `web/src/routes/WorkspaceLayout.tsx`
- Create: `web/src/routes/WorkspaceLayout.test.tsx`

**Interfaces:**
- Consumes: `DataSource`, `useDataSource()`, `TreeNode` from Task 16.
- Produces: `TreeView`, `WorkspaceLayout` React components, both consumed by the router assembled in Task 21.

- [ ] **Step 1: Write the failing tests**

`web/src/components/TreeView.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TreeView } from './TreeView';
import type { TreeNode } from '../datasource/types';

const tree: TreeNode = {
  name: 'WS', path: '', is_dir: true,
  children: [
    {
      name: 'local', path: 'local', is_dir: true,
      children: [{ name: 'guide.md', path: 'local/guide.md', is_dir: false }],
    },
  ],
};

describe('TreeView', () => {
  it('renders a link for each file with the correct href', () => {
    render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" />
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: 'guide.md' });
    expect(link).toHaveAttribute('href', '/w/ws/doc/local/guide.md');
  });

  it('collapses and expands a directory on click', () => {
    render(
      <MemoryRouter>
        <TreeView node={tree} workspaceId="ws" />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'guide.md' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /local/ }));
    expect(screen.queryByRole('link', { name: 'guide.md' })).not.toBeInTheDocument();
  });
});
```

`web/src/routes/WorkspaceLayout.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceLayout } from './WorkspaceLayout';
import { DataSourceProvider } from '../datasource/context';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

function renderWithDataSource(ds: any, path = '/w/ws') {
  (globalThis as any).__testDataSource = ds;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/w/:workspaceId" element={<WorkspaceLayout />}>
          <Route index element={<div>welcome</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('WorkspaceLayout', () => {
  it('shows a loading state then renders the tree', async () => {
    const ds = { getTree: vi.fn().mockResolvedValue({ name: 'WS', path: '', is_dir: true, children: [] }) };
    renderWithDataSource(ds);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => expect(ds.getTree).toHaveBeenCalledWith('ws'));
  });

  it('shows an error message when the tree fails to load', async () => {
    const ds = { getTree: vi.fn().mockRejectedValue(new Error('boom')) };
    renderWithDataSource(ds);
    await waitFor(() => expect(screen.getByText(/failed to load workspace/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run TreeView WorkspaceLayout`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write the implementation**

`web/src/components/TreeView.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TreeNode } from '../datasource/types';

export function TreeView({ node, workspaceId, currentPath }: { node: TreeNode; workspaceId: string; currentPath?: string }) {
  return (
    <ul className="tree">
      {node.children?.map((child) => (
        <TreeNodeItem key={child.path} node={child} workspaceId={workspaceId} currentPath={currentPath} />
      ))}
    </ul>
  );
}

function TreeNodeItem({ node, workspaceId, currentPath }: { node: TreeNode; workspaceId: string; currentPath?: string }) {
  const [open, setOpen] = useState(true);
  if (node.is_dir) {
    return (
      <li>
        <button type="button" className="tree-dir" onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'} {node.name}
        </button>
        {open && (
          <ul>
            {node.children?.map((child) => (
              <TreeNodeItem key={child.path} node={child} workspaceId={workspaceId} currentPath={currentPath} />
            ))}
          </ul>
        )}
      </li>
    );
  }
  const active = node.path === currentPath;
  return (
    <li>
      <Link className={active ? 'tree-file active' : 'tree-file'} to={`/w/${workspaceId}/doc/${node.path}`}>
        {node.name}
      </Link>
    </li>
  );
}
```

`web/src/routes/WorkspaceLayout.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import { TreeView } from '../components/TreeView';
import type { TreeNode } from '../datasource/types';

export function WorkspaceLayout() {
  const { workspaceId = '' } = useParams();
  const ds = useDataSource();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();
  const docPrefix = `/w/${workspaceId}/doc/`;
  const currentPath = location.pathname.startsWith(docPrefix) ? location.pathname.slice(docPrefix.length) : undefined;

  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setError(null);
    ds.getTree(workspaceId).then(
      (t) => !cancelled && setTree(t),
      (e) => !cancelled && setError(String(e))
    );
    return () => {
      cancelled = true;
    };
  }, [ds, workspaceId]);

  if (error) return <div className="error">Failed to load workspace: {error}</div>;
  if (!tree) return <div className="loading">Loading…</div>;

  return (
    <div className="workspace-layout">
      <nav className="sidebar">
        <TreeView node={tree} workspaceId={workspaceId} currentPath={currentPath} />
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run TreeView WorkspaceLayout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/TreeView.tsx web/src/components/TreeView.test.tsx web/src/routes/WorkspaceLayout.tsx web/src/routes/WorkspaceLayout.test.tsx
git commit -m "feat(web): add TreeView and WorkspaceLayout with tree fetch/loading/error states"
```

---

### Task 18: FileViewer page — Markdown + Mermaid rendering

**Files:**
- Create: `web/src/components/MermaidBlock.tsx`
- Create: `web/src/components/MarkdownView.tsx`
- Create: `web/src/components/MarkdownView.test.tsx`
- Create: `web/src/routes/FileViewerPage.tsx`
- Create: `web/src/routes/FileViewerPage.test.tsx`

**Interfaces:**
- Consumes: `useDataSource()`, `FileView` from Task 16.
- Produces: `MarkdownView`, `MermaidBlock`, `FileViewerPage`.

- [ ] **Step 1: Write the failing tests**

`web/src/components/MarkdownView.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"></svg>' }),
  },
}));

import { MarkdownView } from './MarkdownView';

describe('MarkdownView', () => {
  it('renders plain markdown and GFM tables', () => {
    render(<MarkdownView body={'# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders a mermaid fenced block via MermaidBlock', async () => {
    render(<MarkdownView body={'```mermaid\ngraph TD; A-->B;\n```'} />);
    expect(await screen.findByTestId('mermaid-svg')).toBeInTheDocument();
  });

  it('renders raw HTML img tags (server-inlined PlantUML diagrams)', () => {
    render(<MarkdownView body={'<img alt="diagram" src="data:image/svg+xml;base64,AA==" />'} />);
    expect(screen.getByAltText('diagram')).toBeInTheDocument();
  });
});
```

`web/src/routes/FileViewerPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FileViewerPage } from './FileViewerPage';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});
vi.mock('../components/GitHistoryPanel', () => ({ GitHistoryPanel: () => null }));

describe('FileViewerPage', () => {
  it('loads and renders the file title, ai-context badge, and body', async () => {
    (globalThis as any).__testDataSource = {
      getFile: vi.fn().mockResolvedValue({
        path: 'local/CLAUDE.md', title: 'Agent Notes', frontmatter: {}, body: 'hello body', headings: [], is_ai_context: true,
      }),
    };
    render(
      <MemoryRouter initialEntries={['/w/ws/doc/local/CLAUDE.md']}>
        <Routes>
          <Route path="/w/:workspaceId/doc/*" element={<FileViewerPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Agent Notes' })).toBeInTheDocument());
    expect(screen.getByText('AI Context File')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run MarkdownView FileViewerPage`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write the implementation**

```bash
cd web && npm install rehype-raw
```

`web/src/components/MermaidBlock.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let initialized = false;

export function MermaidBlock({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      initialized = true;
    }
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (ref.current) ref.current.innerHTML = svg;
      })
      .catch((e: unknown) => setError(String(e)));
  }, [source]);

  if (error) {
    return <pre className="mermaid-error">Mermaid render failed: {error}</pre>;
  }
  return <div className="mermaid-diagram" data-testid="mermaid-svg" ref={ref} />;
}
```

`web/src/components/MarkdownView.tsx`:

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { MermaidBlock } from './MermaidBlock';

export function MarkdownView({ body }: { body: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        code({ className, children, ...props }) {
          if (/language-mermaid/.test(className ?? '')) {
            return <MermaidBlock source={String(children).replace(/\n$/, '')} />;
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
```

`web/src/routes/FileViewerPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import { MarkdownView } from '../components/MarkdownView';
import { GitHistoryPanel } from '../components/GitHistoryPanel';
import type { FileView } from '../datasource/types';

export function FileViewerPage() {
  const { workspaceId = '', '*': wildcardPath = '' } = useParams();
  const ds = useDataSource();
  const [file, setFile] = useState<FileView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setError(null);
    ds.getFile(workspaceId, wildcardPath).then(
      (f) => !cancelled && setFile(f),
      (e) => !cancelled && setError(String(e))
    );
    return () => {
      cancelled = true;
    };
  }, [ds, workspaceId, wildcardPath]);

  if (error) return <div className="error">Failed to load file: {error}</div>;
  if (!file) return <div className="loading">Loading…</div>;

  return (
    <article>
      {file.is_ai_context && <div className="ai-context-badge">AI Context File</div>}
      <h1>{file.title}</h1>
      <MarkdownView body={file.body} />
      <GitHistoryPanel workspaceId={workspaceId} path={wildcardPath} />
    </article>
  );
}
```

`GitHistoryPanel` is implemented in Task 20; add a temporary placeholder now so this task compiles standalone:

`web/src/components/GitHistoryPanel.tsx` (placeholder, replaced in Task 20):

```tsx
export function GitHistoryPanel(_props: { workspaceId: string; path: string }) {
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run MarkdownView FileViewerPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/src/components/MermaidBlock.tsx web/src/components/MarkdownView.tsx web/src/components/MarkdownView.test.tsx web/src/components/GitHistoryPanel.tsx web/src/routes/FileViewerPage.tsx web/src/routes/FileViewerPage.test.tsx
git commit -m "feat(web): add FileViewerPage with client-side Markdown and Mermaid rendering"
```

---

### Task 19: Search UI page

**Files:**
- Create: `web/src/routes/SearchPage.tsx`
- Create: `web/src/routes/SearchPage.test.tsx`

**Interfaces:**
- Consumes: `useDataSource()`, `SearchResult` from Task 16.
- Produces: `SearchPage`.

- [ ] **Step 1: Write the failing test**

`web/src/routes/SearchPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SearchPage } from './SearchPage';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

function setup(searchImpl: any) {
  (globalThis as any).__testDataSource = { search: searchImpl };
  return render(
    <MemoryRouter initialEntries={['/w/ws/search']}>
      <Routes>
        <Route path="/w/:workspaceId/search" element={<SearchPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SearchPage', () => {
  it('debounces input and renders results with links', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const search = vi.fn().mockResolvedValue([
      { workspace_id: 'ws', source_id: 'local', path: 'guide.md', title: 'Getting Started', snippet: '<mark>getting</mark> started', score: 1 },
    ]);
    setup(search);
    fireEvent.change(screen.getByPlaceholderText(/search this workspace/i), { target: { value: 'getting' } });
    vi.advanceTimersByTime(250);
    await waitFor(() => expect(search).toHaveBeenCalledWith('ws', 'getting'));
    expect(await screen.findByRole('link', { name: 'Getting Started' })).toHaveAttribute(
      'href',
      '/w/ws/doc/local/guide.md'
    );
    vi.useRealTimers();
  });

  it('does not call search for an empty query', () => {
    const search = vi.fn();
    setup(search);
    fireEvent.change(screen.getByPlaceholderText(/search this workspace/i), { target: { value: '' } });
    expect(search).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run SearchPage`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

`web/src/routes/SearchPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import type { SearchResult } from '../datasource/types';

export function SearchPage() {
  const { workspaceId = '' } = useParams();
  const ds = useDataSource();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      ds.search(workspaceId, query).then(
        (r) => !cancelled && setResults(r),
        (e) => !cancelled && setError(String(e))
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [ds, workspaceId, query]);

  return (
    <div className="search-page">
      <input
        autoFocus
        placeholder="Search this workspace…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <div className="error">{error}</div>}
      <ul className="search-results">
        {results.map((r) => (
          <li key={`${r.source_id}/${r.path}`}>
            <Link to={`/w/${workspaceId}/doc/${r.source_id}/${r.path}`}>{r.title}</Link>
            <p dangerouslySetInnerHTML={{ __html: r.snippet }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run SearchPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/SearchPage.tsx web/src/routes/SearchPage.test.tsx
git commit -m "feat(web): add debounced SearchPage"
```

---

### Task 20: AI Context page + Git History/Blame panel

**Files:**
- Create: `web/src/routes/AIContextPage.tsx`
- Create: `web/src/routes/AIContextPage.test.tsx`
- Modify: `web/src/components/GitHistoryPanel.tsx` (replace Task 18's placeholder)
- Create: `web/src/components/GitHistoryPanel.test.tsx`

**Interfaces:**
- Consumes: `useDataSource()`, `AIContextEntry`, `Commit`, `BlameLine` from Task 16.
- Produces: `AIContextPage`, final `GitHistoryPanel`.

- [ ] **Step 1: Write the failing tests**

`web/src/routes/AIContextPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AIContextPage } from './AIContextPage';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

describe('AIContextPage', () => {
  it('lists AI context files and copies concatenated content on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    (globalThis as any).__testDataSource = {
      getAIContext: vi.fn().mockResolvedValue([{ source_id: 'local', path: 'CLAUDE.md', title: 'Claude Notes' }]),
      getFile: vi.fn().mockResolvedValue({ path: 'local/CLAUDE.md', title: 'Claude Notes', body: 'agent instructions', frontmatter: {}, headings: [], is_ai_context: true }),
    };
    render(
      <MemoryRouter initialEntries={['/w/ws/ai-context']}>
        <Routes>
          <Route path="/w/:workspaceId/ai-context" element={<AIContextPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole('link', { name: 'Claude Notes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /copy all/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('agent instructions')));
  });
});
```

`web/src/components/GitHistoryPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../datasource/context', async () => {
  const actual = await vi.importActual<typeof import('../datasource/context')>('../datasource/context');
  return { ...actual, useDataSource: () => (globalThis as any).__testDataSource };
});

import { GitHistoryPanel } from './GitHistoryPanel';

describe('GitHistoryPanel', () => {
  it('renders "no history" when not applicable', async () => {
    (globalThis as any).__testDataSource = {
      getGitHistory: vi.fn().mockResolvedValue({ applicable: false, commits: [] }),
    };
    render(<GitHistoryPanel workspaceId="ws" path="local/guide.md" />);
    expect(await screen.findByText(/no git history/i)).toBeInTheDocument();
  });

  it('renders commits and loads blame on demand', async () => {
    (globalThis as any).__testDataSource = {
      getGitHistory: vi.fn().mockResolvedValue({
        applicable: true,
        commits: [{ hash: 'abc1234', author: 'Jane', email: 'j@example.com', date: '2026-01-01T00:00:00Z', message: 'initial commit' }],
      }),
      getGitBlame: vi.fn().mockResolvedValue({
        applicable: true,
        lines: [{ line_no: 1, hash: 'abc1234', author: 'Jane', date: '2026-01-01T00:00:00Z', text: 'hello' }],
      }),
    };
    render(<GitHistoryPanel workspaceId="ws" path="local/guide.md" />);
    expect(await screen.findByText(/initial commit/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show blame/i }));
    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run AIContextPage GitHistoryPanel`
Expected: FAIL — `AIContextPage` doesn't exist; `GitHistoryPanel` placeholder renders nothing.

- [ ] **Step 3: Write the implementation**

`web/src/routes/AIContextPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import type { AIContextEntry } from '../datasource/types';

export function AIContextPage() {
  const { workspaceId = '' } = useParams();
  const ds = useDataSource();
  const [entries, setEntries] = useState<AIContextEntry[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ds.getAIContext(workspaceId).then(setEntries);
  }, [ds, workspaceId]);

  async function copyAll() {
    const files = await Promise.all(entries.map((e) => ds.getFile(workspaceId, `${e.source_id}/${e.path}`)));
    const text = files.map((f) => `# ${f.path}\n\n${f.body}`).join('\n\n---\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="ai-context-page">
      <button type="button" onClick={copyAll} disabled={entries.length === 0}>
        {copied ? 'Copied!' : `Copy all ${entries.length} as context`}
      </button>
      <ul>
        {entries.map((e) => (
          <li key={`${e.source_id}/${e.path}`}>
            <Link to={`/w/${workspaceId}/doc/${e.source_id}/${e.path}`}>{e.title}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`web/src/components/GitHistoryPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useDataSource } from '../datasource/context';
import type { BlameLine, Commit } from '../datasource/types';

export function GitHistoryPanel({ workspaceId, path }: { workspaceId: string; path: string }) {
  const ds = useDataSource();
  const [state, setState] = useState<{ applicable: boolean; commits: Commit[] } | null>(null);
  const [blame, setBlame] = useState<BlameLine[] | null>(null);

  useEffect(() => {
    setState(null);
    setBlame(null);
    ds.getGitHistory(workspaceId, path).then(setState, () => setState({ applicable: false, commits: [] }));
  }, [ds, workspaceId, path]);

  async function loadBlame() {
    const result = await ds.getGitBlame(workspaceId, path);
    setBlame(result.applicable ? result.lines : []);
  }

  if (!state) return null;
  if (!state.applicable) return <p className="git-history-na">No Git history for this file.</p>;

  return (
    <div className="git-history-panel">
      <ul className="git-history">
        {state.commits.map((c) => (
          <li key={c.hash}>
            <code>{c.hash.slice(0, 7)}</code> {c.message} — {c.author}, {new Date(c.date).toLocaleDateString()}
          </li>
        ))}
      </ul>
      {blame === null ? (
        <button type="button" onClick={loadBlame}>
          Show blame
        </button>
      ) : (
        <table className="blame-table">
          <tbody>
            {blame.map((l) => (
              <tr key={l.line_no}>
                <td className="blame-meta">
                  {l.hash.slice(0, 7)} {l.author}
                </td>
                <td className="blame-line">{l.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run AIContextPage GitHistoryPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/AIContextPage.tsx web/src/routes/AIContextPage.test.tsx web/src/components/GitHistoryPanel.tsx web/src/components/GitHistoryPanel.test.tsx
git commit -m "feat(web): add AIContextPage with copy-as-context, and Git history/blame panel"
```

---
### Task 21: App shell assembly — router, WorkspacePickerPage, styles

**Files:**
- Create: `web/src/routes/WorkspacePickerPage.tsx`
- Create: `web/src/routes/router.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/App.test.tsx`
- Create: `web/src/main.tsx`
- Create: `web/src/styles.css`

**Interfaces:**
- Consumes: `DataSourceProvider`, `WorkspaceLayout`, `FileViewerPage`, `SearchPage`, `AIContextPage` from Tasks 16-20.
- Produces: `App`, `router`, `WorkspacePickerPage` — the assembled SPA entry point.

- [ ] **Step 1: Write the failing test**

`web/src/App.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
  });

  it('renders the workspace picker with a fallback message when no workspaces exist', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/no workspaces configured/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run App.test`
Expected: FAIL — `App` doesn't exist.

- [ ] **Step 3: Write the implementation**

`web/src/routes/WorkspacePickerPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDataSource } from '../datasource/context';
import type { Workspace } from '../datasource/types';

export function WorkspacePickerPage() {
  const ds = useDataSource();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);

  useEffect(() => {
    ds.listWorkspaces().then(setWorkspaces);
  }, [ds]);

  if (workspaces === null) return <div className="loading">Loading…</div>;
  if (workspaces.length === 0) return <div className="empty">No workspaces configured.</div>;

  return (
    <ul className="workspace-picker">
      {workspaces.map((w) => (
        <li key={w.id}>
          <Link to={`/w/${w.id}`}>{w.name}</Link>
        </li>
      ))}
    </ul>
  );
}
```

`web/src/routes/router.tsx`:

```tsx
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
```

`web/src/App.tsx`:

```tsx
import { RouterProvider } from 'react-router-dom';
import { DataSourceProvider } from './datasource/context';
import { router } from './routes/router';
import './styles.css';

export function App() {
  return (
    <DataSourceProvider>
      <RouterProvider router={router} />
    </DataSourceProvider>
  );
}
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

`web/src/styles.css`:

```css
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
}

body {
  margin: 0;
}

.workspace-layout {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 260px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid #8884;
  padding: 1rem;
}

.content {
  flex: 1;
  padding: 1.5rem 2rem;
  min-width: 0;
}

.tree,
.tree ul {
  list-style: none;
  margin: 0;
  padding-left: 0.75rem;
}

.tree {
  padding-left: 0;
}

.tree-dir {
  background: none;
  border: none;
  cursor: pointer;
  font: inherit;
  padding: 0.15rem 0;
}

.tree-file {
  display: block;
  padding: 0.15rem 0;
  text-decoration: none;
}

.tree-file.active {
  font-weight: 700;
}

.ai-context-badge {
  display: inline-block;
  background: #6366f1;
  color: white;
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  border-radius: 0.25rem;
  margin-bottom: 0.5rem;
}

.error {
  color: #dc2626;
}

.blame-table {
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  border-collapse: collapse;
}

.blame-meta {
  color: #8888;
  padding-right: 1rem;
  white-space: nowrap;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run App.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/WorkspacePickerPage.tsx web/src/routes/router.tsx web/src/App.tsx web/src/App.test.tsx web/src/main.tsx web/src/styles.css
git commit -m "feat(web): assemble router, WorkspacePickerPage, and app shell"
```

- [ ] **Step 6: Manually verify the full SPA against a live server**

```bash
CGO_ENABLED=1 go build -tags sqlite_fts5 -o /tmp/dmox-dev ./cmd/dmox
DMOX_CONFIG=config.example.yaml /tmp/dmox-dev serve &
cd web && npm run dev
```

Open `http://localhost:5173`, confirm the workspace picker, tree navigation, a Markdown file with a mermaid block, and search all work end-to-end against the live Go API on `:8080`. Kill both background processes when done.

---

### Task 22: Embed frontend into the Go binary

**Files:**
- Create: `internal/webassets/webassets.go`
- Create: `internal/webassets/webassets_test.go`
- Create: `internal/webassets/dist/index.html` (placeholder, overwritten by the real build)
- Modify: `cmd/dmox/serve.go` (remove the Task 14 stub import)
- Delete: `cmd/dmox/frontend_stub.go`
- Create: `internal/api/frontend_test.go`

**Interfaces:**
- Produces: `webassets.FS() (fs.FS, error)`, `mountFrontend(r *gin.Engine) error` (replacing Task 14's stub).

- [ ] **Step 1: Write the failing tests**

`internal/webassets/webassets_test.go`:

```go
package webassets

import "testing"

func TestFS_ReturnsValidFilesystem(t *testing.T) {
	fsys, err := FS()
	if err != nil {
		t.Fatalf("FS: %v", err)
	}
	if _, err := fsys.Open("index.html"); err != nil {
		t.Fatalf("expected index.html in embedded assets: %v", err)
	}
}
```

`internal/webassets/dist/index.html` (placeholder committed so `go build` succeeds before the frontend is ever built; `make build-frontend` overwrites it):

```html
<!doctype html>
<html>
  <head><title>dmox (unbuilt)</title></head>
  <body>run `make build-frontend` (or `make build`) to embed the real SPA build here</body>
</html>
```

`internal/api/frontend_test.go`:

```go
package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFrontendFallback_ServesIndexHTMLForUnknownRoute(t *testing.T) {
	a := newTestApp(t)
	router := NewRouter(a)
	if err := MountFrontendForTest(router); err != nil {
		t.Fatalf("mount frontend: %v", err)
	}
	srv := httptest.NewServer(router)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/w/ws/doc/local/guide.md")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (SPA shell fallback)", resp.StatusCode)
	}
}

func TestFrontendFallback_APIRoutesStay404JSON(t *testing.T) {
	a := newTestApp(t)
	router := NewRouter(a)
	if err := MountFrontendForTest(router); err != nil {
		t.Fatalf("mount frontend: %v", err)
	}
	srv := httptest.NewServer(router)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/does-not-exist")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
	if resp.Header.Get("Content-Type") == "" {
		t.Fatal("expected a Content-Type header on the JSON 404")
	}
}
```

Note: `mountFrontend` itself lives in `cmd/dmox` (Task 14) since only the main binary imports `internal/webassets`; to make it testable from `internal/api` without a `cmd -> internal` import cycle, the SPA-fallback logic is implemented directly inside `internal/api` as `MountFrontend(r *gin.Engine, assets fs.FS)`, and `cmd/dmox`'s `mountFrontend` becomes a one-line wrapper that passes `webassets.FS()` in. `MountFrontendForTest` in the test above is a small test-only wrapper in the same package that embeds a trivial in-memory `fs.FS` — see Step 3.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/webassets/... ./internal/api/...`
Expected: FAIL — `FS`, `MountFrontendForTest` undefined.

- [ ] **Step 3: Write the implementation**

`internal/webassets/webassets.go`:

```go
package webassets

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

func FS() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
```

Add to `internal/api/server.go` (new function in the same file, appended):

```go
func MountFrontend(r *gin.Engine, assets fs.FS) {
	fileServer := http.FileServer(http.FS(assets))
	r.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		reqPath := strings.TrimPrefix(c.Request.URL.Path, "/")
		if reqPath == "" {
			reqPath = "index.html"
		}
		if _, err := fs.Stat(assets, reqPath); err != nil {
			c.Request.URL.Path = "/" // SPA fallback: unknown client-side routes serve the shell
		}
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}
```

(add `"io/fs"` and `"strings"` to `server.go`'s import block.)

`internal/api/frontend_testutil_test.go`:

```go
package api

import (
	"io/fs"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

func MountFrontendForTest(r *gin.Engine) error {
	assets := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html><body>dmox test shell</body></html>")},
	}
	MountFrontend(r, fs.FS(assets))
	return nil
}
```

Update `cmd/dmox/serve.go` — replace the `mountFrontend` call target: delete `cmd/dmox/frontend_stub.go` and add `cmd/dmox/frontend.go`:

```go
package main

import (
	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/api"
	"github.com/tuannm99/dmox/internal/webassets"
)

func mountFrontend(r *gin.Engine) error {
	assets, err := webassets.FS()
	if err != nil {
		return err
	}
	api.MountFrontend(r, assets)
	return nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
rm cmd/dmox/frontend_stub.go
CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/webassets/... ./internal/api/... ./cmd/dmox/...
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/webassets internal/api/server.go internal/api/frontend_test.go internal/api/frontend_testutil_test.go cmd/dmox/frontend.go
git rm cmd/dmox/frontend_stub.go
git commit -m "feat(web): embed SPA build into the Go binary with SPA-fallback routing"
```

---

### Task 23: Static Site Builder (`dmox build`)

**Files:**
- Create: `internal/staticbuild/build.go`
- Create: `internal/staticbuild/build_test.go`
- Create: `cmd/dmox/build.go`
- Modify: `web/src/datasource/staticDataSource.ts` (no change needed — already reads `import.meta.env.BASE_URL`, see Task 16 note below)

**Interfaces:**
- Consumes: `app.App`, `doctree.Build`, `doctree.CollectLeaves`, `doctree.SplitSourcePath`, `index.Parse`, `index.IsAIContextFile`, `render.FileView`, `render.ExtractHeadings`, `(*PlantUMLRenderer).RenderBlocks`, `search.Result`, `gitsvc.Commit`/`BlameLine`, `source.GitSource`, `webassets.FS`.
- Produces: `staticbuild.Options{WorkspaceID, OutDir, BasePath}`, `staticbuild.Build(ctx, a *app.App, opts Options) error`.

**Design note on `--base-path`:** the embedded SPA is built once, at Go-compile time, with Vite `base: '/__DMOX_BASE__/'` (Task 16). Vite inlines that string literally into every emitted `.html`/`.js`/`.css` file, including the compiled value of `import.meta.env.BASE_URL` that `staticDataSource.ts` reads at runtime. `dmox build` performs a byte-level find/replace of `/__DMOX_BASE__/` → the normalized `--base-path` value across every emitted text asset as it copies them into the output directory — correctly repointing every asset and data-fetch URL for the target deploy path without needing to rebuild the frontend per export.

- [ ] **Step 1: Write the failing test**

`internal/staticbuild/build_test.go`:

```go
package staticbuild

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/api"
	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/config"
	"github.com/tuannm99/dmox/internal/doctree"
	"github.com/tuannm99/dmox/internal/render"
)

func newFixtureApp(t *testing.T) (*app.App, string) {
	t.Helper()
	docsDir := t.TempDir()
	mustWrite(t, filepath.Join(docsDir, "guide.md"), "---\ntitle: Guide\n---\n# Guide\nhello world")
	mustWrite(t, filepath.Join(docsDir, "CLAUDE.md"), "agent instructions")
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
	t.Cleanup(func() { a.Close() })
	return a, docsDir
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestBuild_ProducesExpectedDataFiles(t *testing.T) {
	a, _ := newFixtureApp(t)
	out := t.TempDir()
	ctx := context.Background()
	if err := Build(ctx, a, Options{WorkspaceID: "ws", OutDir: out, BasePath: "/repo/"}); err != nil {
		t.Fatalf("Build: %v", err)
	}

	requireFile := func(rel string) []byte {
		b, err := os.ReadFile(filepath.Join(out, rel))
		if err != nil {
			t.Fatalf("expected %s to exist: %v", rel, err)
		}
		return b
	}

	var tree doctree.TreeNode
	json.Unmarshal(requireFile("data/tree.json"), &tree)
	var leaves []string
	doctree.CollectLeaves(tree, &leaves)
	if len(leaves) != 2 {
		t.Fatalf("leaves = %+v, want 2", leaves)
	}

	var fv render.FileView
	json.Unmarshal(requireFile("data/files/local/guide.md.json"), &fv)
	if fv.Title != "Guide" {
		t.Fatalf("Title = %q", fv.Title)
	}

	var aiContext []map[string]string
	json.Unmarshal(requireFile("data/ai-context.json"), &aiContext)
	if len(aiContext) != 1 || aiContext[0]["path"] != "CLAUDE.md" {
		t.Fatalf("ai-context = %+v", aiContext)
	}

	var searchIndex []map[string]any
	json.Unmarshal(requireFile("data/search-index.json"), &searchIndex)
	if len(searchIndex) != 2 {
		t.Fatalf("search index = %+v, want 2 entries", searchIndex)
	}

	requireFile("index.html")
	shell := requireFile("w/ws/doc/local/guide.md/index.html")
	if !contains(string(shell), "/repo/") {
		t.Fatalf("route shell should have base-path token replaced with /repo/, got: %s", shell)
	}
	if contains(string(shell), "__DMOX_BASE__") {
		t.Fatalf("route shell still contains unreplaced base-path token: %s", shell)
	}
}

func TestBuild_SchemaMatchesLiveAPI(t *testing.T) {
	a, _ := newFixtureApp(t)
	ctx := context.Background()
	if err := a.SyncAndIndexAll(ctx, true); err != nil {
		t.Fatalf("SyncAndIndexAll: %v", err)
	}
	srv := httptest.NewServer(api.NewRouter(a))
	defer srv.Close()

	liveResp, err := http.Get(srv.URL + "/api/workspaces/ws/file?path=local/guide.md")
	if err != nil {
		t.Fatal(err)
	}
	defer liveResp.Body.Close()
	var liveFV render.FileView
	json.NewDecoder(liveResp.Body).Decode(&liveFV)

	out := t.TempDir()
	if err := Build(ctx, a, Options{WorkspaceID: "ws", OutDir: out, BasePath: "/"}); err != nil {
		t.Fatalf("Build: %v", err)
	}
	staticBytes, err := os.ReadFile(filepath.Join(out, "data", "files", "local", "guide.md.json"))
	if err != nil {
		t.Fatal(err)
	}
	var staticFV render.FileView
	json.Unmarshal(staticBytes, &staticFV)

	if liveFV.Title != staticFV.Title || liveFV.Path != staticFV.Path || liveFV.IsAIContext != staticFV.IsAIContext {
		t.Fatalf("static export FileView %+v does not match live API FileView %+v", staticFV, liveFV)
	}
}

func TestBuild_FailsFastOnSourceSyncError(t *testing.T) {
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{{ID: "local", Type: "local", Path: "/nonexistent/path"}}},
		},
	}
	a, err := app.New(cfg)
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	defer a.Close()

	err = Build(context.Background(), a, Options{WorkspaceID: "ws", OutDir: t.TempDir(), BasePath: "/"})
	if err == nil {
		t.Fatal("expected Build to fail fast on a source sync error")
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (func() bool {
		for i := 0; i+len(substr) <= len(s); i++ {
			if s[i:i+len(substr)] == substr {
				return true
			}
		}
		return false
	})()
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/staticbuild/...`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Write the implementation**

`internal/staticbuild/build.go`:

```go
package staticbuild

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/doctree"
	"github.com/tuannm99/dmox/internal/gitsvc"
	"github.com/tuannm99/dmox/internal/index"
	"github.com/tuannm99/dmox/internal/render"
	"github.com/tuannm99/dmox/internal/search"
	"github.com/tuannm99/dmox/internal/source"
	"github.com/tuannm99/dmox/internal/webassets"
)

type Options struct {
	WorkspaceID string
	OutDir      string
	BasePath    string
}

const basePathPlaceholder = "/__DMOX_BASE__/"

func Build(ctx context.Context, a *app.App, opts Options) error {
	ws, ok := a.Workspace(opts.WorkspaceID)
	if !ok {
		return fmt.Errorf("workspace %q not found", opts.WorkspaceID)
	}
	if err := os.MkdirAll(filepath.Join(opts.OutDir, "data", "files"), 0o755); err != nil {
		return fmt.Errorf("create output dir: %w", err)
	}

	for _, src := range ws.Sources {
		if err := src.Sync(ctx); err != nil {
			return fmt.Errorf("build: sync %s: %w", src.ID(), err)
		}
		if err := a.Indexer.IndexSource(ctx, opts.WorkspaceID, src); err != nil {
			return fmt.Errorf("build: index %s: %w", src.ID(), err)
		}
	}

	tree, err := doctree.Build(ctx, ws.Cfg.Name, ws.SourceIDs(), ws.Sources)
	if err != nil {
		return fmt.Errorf("build: tree: %w", err)
	}
	if err := writeJSON(filepath.Join(opts.OutDir, "data", "tree.json"), tree); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(opts.OutDir, "data", "workspaces.json"),
		[]map[string]string{{"id": ws.Cfg.ID, "name": ws.Cfg.Name}}); err != nil {
		return err
	}

	var leaves []string
	doctree.CollectLeaves(tree, &leaves)

	searchIndex := []search.Result{}
	aiContext := []map[string]string{}
	gitData := map[string]any{}

	for _, path := range leaves {
		sourceID, relPath, err := doctree.SplitSourcePath(path)
		if err != nil {
			return fmt.Errorf("build: %w", err)
		}
		src := ws.Sources[sourceID]
		raw, err := src.Read(ctx, relPath)
		if err != nil {
			return fmt.Errorf("build: read %s: %w", path, err)
		}
		doc := index.Parse(raw, filepath.Base(relPath))
		body := a.PlantUML.RenderBlocks(ctx, doc.Body)
		isAI := index.IsAIContextFile(relPath)
		fv := render.FileView{
			Path: path, Title: doc.Title, Frontmatter: doc.Frontmatter, Body: body,
			Headings: render.ExtractHeadings(doc.Body), IsAIContext: isAI,
		}
		if err := writeJSON(filepath.Join(opts.OutDir, "data", "files", path+".json"), fv); err != nil {
			return fmt.Errorf("build: write file json %s: %w", path, err)
		}
		searchIndex = append(searchIndex, search.Result{
			WorkspaceID: opts.WorkspaceID, SourceID: sourceID, Path: relPath, Title: doc.Title,
			Snippet: snippetOf(doc.Body),
		})
		if isAI {
			aiContext = append(aiContext, map[string]string{"source_id": sourceID, "path": relPath, "title": doc.Title})
		}

		if gitSrc, ok := src.(*source.GitSource); ok {
			commits, err := a.Git.History(gitSrc.MirrorDir(), relPath, 50)
			if err != nil {
				return fmt.Errorf("build: git history %s: %w", path, err)
			}
			gitData[path] = map[string]any{"applicable": true, "commits": commits}
			lines, err := a.Git.Blame(gitSrc.MirrorDir(), relPath)
			if err != nil {
				return fmt.Errorf("build: git blame %s: %w", path, err)
			}
			gitData[path+"#blame"] = map[string]any{"applicable": true, "lines": lines}
		} else {
			gitData[path] = map[string]any{"applicable": false, "commits": []gitsvc.Commit{}}
			gitData[path+"#blame"] = map[string]any{"applicable": false, "lines": []gitsvc.BlameLine{}}
		}
	}

	if err := writeJSON(filepath.Join(opts.OutDir, "data", "search-index.json"), searchIndex); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(opts.OutDir, "data", "ai-context.json"), aiContext); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(opts.OutDir, "data", "git-history.json"), gitData); err != nil {
		return err
	}

	if err := copySPAAssets(opts.OutDir, opts.BasePath); err != nil {
		return fmt.Errorf("build: copy spa assets: %w", err)
	}
	if err := writeRouteShells(opts.OutDir, leaves, opts.WorkspaceID); err != nil {
		return fmt.Errorf("build: route shells: %w", err)
	}
	return nil
}

func writeJSON(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func snippetOf(body string) string {
	plain := strings.Join(strings.Fields(body), " ")
	if len(plain) > 200 {
		return plain[:200] + "…"
	}
	return plain
}

var textExt = map[string]bool{".html": true, ".js": true, ".css": true, ".json": true, ".map": true}

func copySPAAssets(outDir, basePath string) error {
	if basePath == "" {
		basePath = "/"
	}
	if !strings.HasSuffix(basePath, "/") {
		basePath += "/"
	}
	assets, err := webassets.FS()
	if err != nil {
		return err
	}
	return fs.WalkDir(assets, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		dest := filepath.Join(outDir, p)
		if d.IsDir() {
			return os.MkdirAll(dest, 0o755)
		}
		data, err := fs.ReadFile(assets, p)
		if err != nil {
			return err
		}
		if textExt[filepath.Ext(p)] {
			data = bytes.ReplaceAll(data, []byte(basePathPlaceholder), []byte(basePath))
		}
		return os.WriteFile(dest, data, 0o644)
	})
}

func writeRouteShells(outDir string, leaves []string, workspaceID string) error {
	shell, err := os.ReadFile(filepath.Join(outDir, "index.html"))
	if err != nil {
		return fmt.Errorf("read root index.html: %w", err)
	}
	routes := []string{filepath.Join("w", workspaceID)}
	for _, path := range leaves {
		routes = append(routes, filepath.Join("w", workspaceID, "doc", path))
	}
	for _, route := range routes {
		dir := filepath.Join(outDir, route)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, "index.html"), shell, 0o644); err != nil {
			return err
		}
	}
	return nil
}
```

`cmd/dmox/build.go`:

```go
package main

import (
	"context"
	"flag"
	"fmt"
	"log"

	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/staticbuild"
)

func runBuildCmd(args []string) {
	fs := flag.NewFlagSet("build", flag.ExitOnError)
	workspace := fs.String("workspace", "", "workspace id")
	out := fs.String("out", "./dist", "output directory")
	basePath := fs.String("base-path", "/", "base path for deployment, e.g. /repo-name/")
	fs.Parse(args)
	if *workspace == "" {
		log.Fatal("dmox build: --workspace is required")
	}
	cfg := mustLoadConfig()
	a, err := app.New(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer a.Close()

	err = staticbuild.Build(context.Background(), a, staticbuild.Options{
		WorkspaceID: *workspace, OutDir: *out, BasePath: *basePath,
	})
	if err != nil {
		log.Fatalf("dmox build failed: %v", err)
	}
	fmt.Printf("dmox build: wrote static export to %s\n", *out)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/staticbuild/... ./cmd/dmox/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/staticbuild cmd/dmox/build.go
git commit -m "feat(build): add dmox build static exporter with base-path token substitution"
```

---

### Task 24: Playwright smoke tests (live + static projects)

**Files:**
- Create: `web/playwright.config.ts`
- Create: `web/tests/e2e/browse-search.spec.ts`

**Interfaces:**
- Consumes: a running `dmox serve` fixture (project `live`) and a `dmox build` static export served by a plain static file server (project `static`) — both run manually/in CI, not part of `npm test`'s fast unit loop (spec §6).

- [ ] **Step 1: Write the Playwright config and spec**

```bash
cd web && npm install -D @playwright/test
npx playwright install --with-deps chromium
```

`web/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  projects: [
    { name: 'live', use: { baseURL: 'http://localhost:8080' } },
    { name: 'static', use: { baseURL: 'http://localhost:4173' } },
  ],
  retries: 0,
  timeout: 30_000,
});
```

`web/tests/e2e/browse-search.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('browse -> search happy path', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /example docs/i }).click();
  await expect(page).toHaveURL(/\/w\/example/);
  await page.getByRole('link', { name: 'guide.md' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('deep link into a doc route loads directly without prior client-side navigation', async ({ page, baseURL }) => {
  const prefix = baseURL?.includes('4173') ? '/w/example/doc/local/guide.md' : '/w/example/doc/local/guide.md';
  await page.goto(prefix);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
```

- [ ] **Step 2: Run against `dmox serve` (project `live`)**

```bash
CGO_ENABLED=1 go build -tags sqlite_fts5 -o /tmp/dmox-dev ./cmd/dmox
DMOX_CONFIG=config.yaml /tmp/dmox-dev serve &
cd web && npx playwright test --project=live
kill %1
```

Expected: both tests PASS against the live server (requires Task 25's `config.yaml` + `example/docs` fixture to exist first — run this step after Task 25).

- [ ] **Step 3: Run against a `dmox build` static export (project `static`)**

```bash
CGO_ENABLED=1 go build -tags sqlite_fts5 -o /tmp/dmox-dev ./cmd/dmox
/tmp/dmox-dev build --workspace example --out /tmp/dmox-dist --base-path /
npx serve -l 4173 /tmp/dmox-dist &
cd web && npx playwright test --project=static
kill %1
```

Expected: both tests PASS against the static export, confirming the per-route shell trick (§2) works with no server-side rewrite rule.

- [ ] **Step 4: Commit**

```bash
git add web/playwright.config.ts web/tests/e2e
git commit -m "test(web): add Playwright browse->search smoke tests for live and static builds"
```

---

### Task 25: Makefile, README, example fixture workspace, full-suite verification

**Files:**
- Create: `Makefile`
- Create: `README.md`
- Create: `config.yaml`
- Create: `example/docs/index.md`
- Create: `example/docs/guide.md`
- Create: `example/docs/CLAUDE.md`
- Create: `.gitignore`

**Interfaces:**
- Consumes: every package built in Tasks 1-24.
- Produces: a runnable local-dev setup and a verified end-to-end build.

- [ ] **Step 1: Create the example workspace fixture**

`example/docs/index.md`:

```markdown
---
title: DMOX Example Docs
---

# DMOX Example Docs

This is a fixture workspace used for local development and manual verification
of `dmox serve` / `dmox build`. See [guide.md](./guide.md) for a walkthrough
and a Mermaid diagram.
```

`example/docs/guide.md`:

```markdown
# Guide

This page demonstrates client-side Mermaid rendering.

\`\`\`mermaid
graph TD
  A[Browse] --> B[Search]
  B --> C[Read]
\`\`\`
```

`example/docs/CLAUDE.md`:

```markdown
# Agent Instructions

This file is an example AI-context file. DMOX surfaces files like this one
distinctly in the "AI Context" view and via `dmox context --workspace example`.
```

`config.yaml` (repo root, local-dev config — no secrets, safe to commit):

```yaml
workspaces:
  - id: example
    name: "Example Docs"
    sources:
      - id: local
        type: local
        path: ./example/docs
data_dir: ~/.dmox
server:
  addr: ":8080"
```

- [ ] **Step 2: Write the Makefile and README**

`Makefile`:

```makefile
.PHONY: build-frontend build test run

build-frontend:
	cd web && npm ci && npm run build
	rm -rf internal/webassets/dist
	mkdir -p internal/webassets/dist
	cp -r web/dist/. internal/webassets/dist/

build: build-frontend
	CGO_ENABLED=1 go build -tags sqlite_fts5 -o bin/dmox ./cmd/dmox

test:
	CGO_ENABLED=1 go test -tags sqlite_fts5 ./...
	cd web && npx vitest run

run: build
	./bin/dmox serve
```

`README.md`:

```markdown
# DMOX

A read-only, local-first, Git-backed documentation browser with search and
Git history, distributed as a single Go binary. See
`docs/superpowers/specs/2026-07-17-dmox-core-platform-design.md` for the full
design.

## Local development

Backend + frontend against the live API (two terminals):

    CGO_ENABLED=1 go build -tags sqlite_fts5 -o bin/dmox ./cmd/dmox
    ./bin/dmox serve          # serves the REST API on :8080 against ./example/docs

    cd web && npm install && npm run dev   # Vite dev server on :5173, talks to :8080

Full binary with the embedded frontend:

    make build
    ./bin/dmox serve

Static export:

    make build
    ./bin/dmox build --workspace example --out ./dist --base-path /

## Tests

    make test

Playwright smoke tests are run manually against a running `dmox serve` or
`dmox build` output — see Task 24 of the implementation plan for exact
commands.
```

`.gitignore`:

```
/bin/
/dist/
node_modules/
web/dist/
internal/webassets/dist/*
!internal/webassets/dist/index.html
.dmox/
```

- [ ] **Step 3: Run the full test suite**

```bash
CGO_ENABLED=1 go test -tags sqlite_fts5 ./...
cd web && npx vitest run
```

Expected: PASS across every Go package and every Vitest suite.

- [ ] **Step 4: Manually verify the built binary end-to-end**

```bash
make build
DMOX_CONFIG=config.yaml ./bin/dmox serve &
sleep 1
curl -s http://localhost:8080/api/workspaces
curl -s "http://localhost:8080/api/workspaces/example/tree"
curl -s "http://localhost:8080/api/workspaces/example/file?path=local/guide.md" | head -c 300
curl -s "http://localhost:8080/api/workspaces/example/search?q=mermaid"
curl -s "http://localhost:8080/api/workspaces/example/ai-context"
kill %1
```

Open `http://localhost:8080` in a browser while the server is running and confirm: the workspace picker shows "Example Docs"; the tree shows `local/index.md`, `local/guide.md`, `local/CLAUDE.md`; opening `guide.md` renders the Mermaid diagram; Search finds "mermaid"; the AI Context page lists `CLAUDE.md` and "Copy all as context" populates the clipboard.

Then verify the static export and the CLI:

```bash
./bin/dmox build --workspace example --out /tmp/dmox-dist --base-path /
npx --yes serve -l 4173 /tmp/dmox-dist &
sleep 1
curl -sI http://localhost:4173/w/example/doc/local/guide.md | head -1   # expect 200, not a 404/redirect
kill %1

DMOX_CONFIG=config.yaml ./bin/dmox serve &
sleep 1
./bin/dmox tree --workspace example
./bin/dmox context --workspace example --filter ai
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add Makefile README.md config.yaml example .gitignore
git commit -m "chore: add Makefile, README, example fixture workspace, and .gitignore"
```

---

## Self-Review

**Spec coverage:**
- Multi-source workspaces, Markdown + Mermaid (client) + PlantUML (local, cached) — Tasks 3-4, 10, 18.
- FTS5 + opt-in semantic search — Tasks 5, 7, 9.
- Read-only Git history/blame, empty-not-error for local sources — Tasks 8, 13, 20.
- AI Context view + `dmox context` CLI — Tasks 6, 13, 15, 20.
- `dmox tree`/`dmox context` CLI over the same REST API — Task 15.
- Static export (`dmox build`) with the exact `dist/` shape, per-route shells, `--base-path` — Tasks 22-23.
- Config hot-reload, fail-fast on invalid config — Tasks 1-2.
- Error handling per spec §5 (source sync failure degrades gracefully in `serve`/fails fast in `build`; embeddings failure degrades to FTS-only; PlantUML failure shows raw source + notice; malformed frontmatter best-effort parses) — Tasks 6 (best-effort `Parse`), 9 (semantic degrade), 10 (PlantUML degrade), 11/14/23 (sync fail-fast vs. degrade).
- Testing strategy: Go table-driven unit tests with temp dirs/local git fixtures throughout Tasks 1-15; Gin `httptest` integration tests in Tasks 12-13, 22-23; Vitest+RTL component tests in Tasks 16-21; static-build schema-parity + route-shell test in Task 23; Playwright browse→search smoke test in Task 24.

**Placeholder scan:** no `TODO`/`TBD` left in any task's code; the two intentional stand-ins (`cmd/dmox/frontend_stub.go` in Task 14, replaced in Task 22; `GitHistoryPanel` placeholder in Task 18, replaced in Task 20) are each fully implemented and swapped in by name in a later, explicitly cross-referenced task — not left dangling.

**Type consistency:** `doctree.TreeNode` / TS `TreeNode`, `render.FileView` / TS `FileView`, `search.Result` / TS `SearchResult`, `gitsvc.Commit`/`BlameLine` / TS `Commit`/`BlameLine` keep matching JSON field names end-to-end from Task 10-11 through Task 23's static export and Task 16's frontend types. `app.Workspace.SourceIDs()`, `doctree.Build`, `doctree.SplitSourcePath` are defined once in Task 11 and reused verbatim (not redefined) by `internal/api` (Tasks 12-13) and `internal/staticbuild` (Task 23).




