# General File Viewer (#7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let DMOX open and view any allowlisted text/code/config file, not just `.md`, with client-side syntax highlighting and a ~1MB plaintext fallback.

**Architecture:** Widen the single gate (`source.List` → `IsDocFile`) via a three-way `source.Classify` (unsupported/doc/text). Tree lists everything viewable; the FTS index stays docs-only behind a new guard; the file API and static build branch to a raw "code" `FileView`; the frontend renders `kind:"code"` with a new `CodeView` (lazy highlight.js). Purely additive — the markdown and index paths are unchanged.

**Tech Stack:** Go (CGO + `sqlite_fts5`), Gin, React + TypeScript (Vite, vitest), highlight.js (new, lazy-loaded).

## Global Constraints

- Backend build/test ALWAYS: `CGO_ENABLED=1 go ... -tags sqlite_fts5`. Plain `go build`/`go test` misbehaves.
- `gofmt -l .` must report nothing before any commit.
- Frontend: run `npx tsc -b --force` and `npx vitest run` from `web/`. Any new data-fetching path needs BOTH `liveDataSource` and `staticDataSource` working.
- Keep any react component map / render-prop referentially stable (see `MarkdownView.tsx` note in CLAUDE.md) — building it inline per render remounts the subtree and breaks scroll.
- Do NOT modify the user's uncommitted `config.yaml`, `docker-compose.override.yml`, or untracked `resume`.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8
  ```
- `maxHighlightBytes = 1 << 20` (1 MiB) — the size cap constant, one definition.

## File Structure

- `internal/source/classify.go` (create) — `FileClass`, `Classify`, `IsViewable`, `IsIndexed`, `HighlightLanguage`.
- `internal/source/source.go` (modify) — remove `IsDocFile`.
- `internal/source/local.go`, `internal/source/git.go` (modify) — `List` uses `Classify != ClassUnsupported`.
- `internal/index/indexer.go` (modify) — skip `!IsIndexed` in `IndexSource`, guard `IndexFile`.
- `internal/api/git_handlers.go` (modify) — status filter `IsDocFile` → `IsViewable`.
- `internal/render/render.go` (modify) — `FileView` gains `Kind/Language/TooLargeToHighlight`; add `CodeFileView`.
- `internal/api/workspace_handlers.go` (modify) — `handleFile` branches doc vs code.
- `internal/staticbuild/build.go` (modify) — per-leaf branch doc vs code.
- `web/src/datasource/types.ts` (modify) — `FileView` gains `kind/language/tooLargeToHighlight`.
- `web/src/components/CodeView.tsx` (create) + `web/src/highlight.ts` (create) — code renderer + lazy highlighter.
- `web/src/routes/FileViewerPage.tsx` (modify) — branch on `kind`.
- `web/src/styles.css` (modify) — `.code-view` styles.

---

### Task 1: Backend file classification (pure)

**Files:**
- Create: `internal/source/classify.go`
- Create: `internal/source/classify_test.go`

**Interfaces:**
- Consumes: `extLower(name string) string` (exists in `internal/source/local.go`).
- Produces:
  - `type FileClass int` with `ClassUnsupported FileClass = iota`, `ClassDoc`, `ClassText`.
  - `func Classify(name string) FileClass`
  - `func IsViewable(name string) bool` (= `Classify(name) != ClassUnsupported`)
  - `func IsIndexed(name string) bool` (= `Classify(name) == ClassDoc`)
  - `func HighlightLanguage(name string) string` (highlight.js id, `""` if unknown)

- [ ] **Step 1: Write the failing test**

```go
package source

import "testing"

func TestClassify(t *testing.T) {
	cases := map[string]FileClass{
		"README.md": ClassDoc, "notes.markdown": ClassDoc,
		"main.go": ClassText, "app.ts": ClassText, "conf.yml": ClassText,
		"data.json": ClassText, "notes.txt": ClassText, "diagram.mmd": ClassText,
		"Dockerfile": ClassText, "Makefile": ClassText, "Jenkinsfile": ClassText,
		"logo.png": ClassUnsupported, "archive.zip": ClassUnsupported,
		"mystery": ClassUnsupported, "README.MD": ClassDoc, "MAIN.GO": ClassText,
	}
	for name, want := range cases {
		if got := Classify(name); got != want {
			t.Errorf("Classify(%q) = %d, want %d", name, got, want)
		}
	}
}

func TestViewableAndIndexed(t *testing.T) {
	if !IsViewable("main.go") || !IsViewable("README.md") {
		t.Fatal("code and docs must be viewable")
	}
	if IsViewable("logo.png") {
		t.Fatal("binary must not be viewable")
	}
	if !IsIndexed("README.md") {
		t.Fatal("docs must be indexed")
	}
	if IsIndexed("main.go") {
		t.Fatal("code must NOT be indexed in v1")
	}
}

func TestHighlightLanguage(t *testing.T) {
	cases := map[string]string{
		"main.go": "go", "app.ts": "typescript", "s.py": "python",
		"Dockerfile": "dockerfile", "conf.yml": "yaml", "x.json": "json",
		"mystery.xyz": "",
	}
	for name, want := range cases {
		if got := HighlightLanguage(name); got != want {
			t.Errorf("HighlightLanguage(%q) = %q, want %q", name, got, want)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/source/ -run 'TestClassify|TestViewable|TestHighlight' -v`
Expected: FAIL — `undefined: Classify` etc.

- [ ] **Step 3: Write minimal implementation**

```go
package source

// FileClass is how DMOX treats a file by name.
type FileClass int

const (
	// ClassUnsupported is hidden from the tree (binary or unknown).
	ClassUnsupported FileClass = iota
	// ClassDoc is rendered as markdown AND fed to the FTS index.
	ClassDoc
	// ClassText is viewable (raw + syntax highlight) but not indexed in v1.
	ClassText
)

// textExts maps a lowercase extension (with dot) to a highlight.js language
// id. Presence here => ClassText. An empty value means "viewable, but we have
// no highlighter for it" (rendered as plaintext).
var textExts = map[string]string{
	".txt": "", ".rst": "", ".adoc": "", ".mdx": "markdown",
	".go": "go", ".rs": "rust", ".ts": "typescript", ".tsx": "typescript",
	".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
	".py": "python", ".java": "java", ".c": "c", ".h": "c",
	".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp", ".hh": "cpp",
	".yaml": "yaml", ".yml": "yaml", ".json": "json", ".toml": "ini",
	".xml": "xml", ".sql": "sql", ".sh": "bash", ".bash": "bash", ".zsh": "bash",
	".mmd": "", ".puml": "", ".plantuml": "",
}

// textNames maps a whole basename (extensionless config files) to a language.
var textNames = map[string]string{
	"Dockerfile": "dockerfile", "Makefile": "makefile", "Jenkinsfile": "groovy",
}

func docExt(ext string) bool { return ext == ".md" || ext == ".markdown" }

// Classify decides how a filename is treated. Case-insensitive on extension;
// basename rules are case-sensitive (Dockerfile, not dockerfile).
func Classify(name string) FileClass {
	base := baseName(name)
	if _, ok := textNames[base]; ok {
		return ClassText
	}
	ext := extLower(name)
	if docExt(ext) {
		return ClassDoc
	}
	if _, ok := textExts[ext]; ok {
		return ClassText
	}
	return ClassUnsupported
}

// IsViewable reports whether the file may appear in the tree and be opened.
func IsViewable(name string) bool { return Classify(name) != ClassUnsupported }

// IsIndexed reports whether the file is fed to the FTS index. Docs only in v1;
// widen this (e.g. to include ClassText) behind a config flag later.
func IsIndexed(name string) bool { return Classify(name) == ClassDoc }

// HighlightLanguage returns the highlight.js language id for a file, or "" when
// unknown (render as plaintext).
func HighlightLanguage(name string) string {
	if lang, ok := textNames[baseName(name)]; ok {
		return lang
	}
	return textExts[extLower(name)]
}
```

Add the `baseName` helper next to `extLower` in `internal/source/local.go`:

```go
func baseName(name string) string {
	if i := strings.LastIndexAny(name, "/\\"); i >= 0 {
		return name[i+1:]
	}
	return name
}
```

(`strings` is already imported in `local.go`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/source/ -run 'TestClassify|TestViewable|TestHighlight' -v`
Expected: PASS

- [ ] **Step 5: gofmt + commit**

```bash
gofmt -w internal/source/classify.go internal/source/local.go internal/source/classify_test.go
git add internal/source/classify.go internal/source/classify_test.go internal/source/local.go
git commit -m "feat: source.Classify for doc/text/unsupported file classes

$(cat <<'EOF'
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8
EOF
)"
```

---

### Task 2: Widen the tree, keep the index docs-only

**Files:**
- Modify: `internal/source/local.go` (the `IsDocFile` check in `List`, ~line 52)
- Modify: `internal/source/git.go` (the `IsDocFile` check in `List`, ~line 93)
- Modify: `internal/source/source.go` (remove `IsDocFile`, ~lines 40-46)
- Modify: `internal/index/indexer.go` (`IndexSource` loop ~line 27, `IndexFile` ~line 41)
- Modify: `internal/api/git_handlers.go` (~line 128)
- Create: `internal/index/indexer_viewer_test.go`

**Interfaces:**
- Consumes: `Classify`, `IsViewable`, `IsIndexed` (Task 1).
- Produces: `List()` returns doc+text files; the index still ingests only `ClassDoc`.

- [ ] **Step 1: Write the failing test** — index must ignore code files even though `List` now returns them.

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

func TestIndexSource_SkipsNonDocFiles(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("guide.md", "# Guide\nhello")
	write("main.go", "package main\nfunc main(){}")

	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ix := New(st)
	src := source.NewLocalSource("local", dir)
	if err := ix.IndexSource(context.Background(), "ws", src); err != nil {
		t.Fatal(err)
	}

	var n int
	if err := st.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE workspace_id='ws'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("indexed %d files, want 1 (only guide.md; main.go must be skipped)", n)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/index/ -run TestIndexSource_SkipsNonDoc -v`
Expected: FAIL — indexes 2 files (once `List` is widened) or compile-dependent; confirm it reports the guard is missing.

- [ ] **Step 3: Make the edits**

`internal/source/local.go` — in `List`, replace:
```go
		if !IsDocFile(d.Name()) {
			return nil
		}
```
with:
```go
		if !IsViewable(d.Name()) {
			return nil
		}
```

`internal/source/git.go` — same replacement at its `List` check.

`internal/source/source.go` — delete the `IsDocFile` function and its doc comment (lines 40-46).

`internal/index/indexer.go` — in `IndexSource`, inside `for _, f := range files {`, add as the first line of the loop body:
```go
		if !source.IsIndexed(f.Path) {
			continue
		}
```
(`source` is already imported in indexer.go.) In `IndexFile`, add as the first statement:
```go
	if !source.IsIndexed(path) {
		return nil
	}
```

`internal/api/git_handlers.go` — replace `if source.IsDocFile(f.Path) {` with `if source.IsViewable(f.Path) {` and update the nearby comment to say "files that have a node in the tree (docs + viewable code/config)".

- [ ] **Step 4: Add a List test** in `internal/source/classify_test.go`:

```go
func TestLocalSource_ListIncludesCodeExcludesBinary(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"guide.md", "main.go", "conf.yml", "logo.png"} {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	src := NewLocalSource("local", dir)
	files, err := src.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, f := range files {
		got[f.Path] = true
	}
	if !got["guide.md"] || !got["main.go"] || !got["conf.yml"] {
		t.Fatalf("want guide.md, main.go, conf.yml listed; got %v", got)
	}
	if got["logo.png"] {
		t.Fatal("binary logo.png must not be listed")
	}
}
```
Add imports `"context"`, `"os"`, `"path/filepath"` to `classify_test.go`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/source/ ./internal/index/ ./internal/api/ -v`
Expected: PASS (all packages compile — `IsDocFile` fully removed).

- [ ] **Step 6: gofmt + commit**

```bash
gofmt -w internal/source/ internal/index/ internal/api/
git add internal/source/ internal/index/ internal/api/git_handlers.go
git commit -m "feat: list code files in the tree, keep FTS index docs-only

Widen source.List to every viewable file and add the guard the indexer never
had (it indexed whatever List returned), so code files show up but stay out of
search. Git status filter follows the same viewable rule.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

### Task 3: `FileView` code fields + `CodeFileView`

**Files:**
- Modify: `internal/render/render.go` (`FileView` struct ~lines 5-12)
- Create: `internal/render/code_test.go`

**Interfaces:**
- Produces:
  - `FileView` gains `Kind string json:"kind"`, `Language string json:"language,omitempty"`, `TooLargeToHighlight bool json:"tooLargeToHighlight,omitempty"`.
  - `func CodeFileView(path string, raw []byte, language string, maxBytes int) FileView`

- [ ] **Step 1: Write the failing test**

```go
package render

import (
	"strings"
	"testing"
)

func TestCodeFileView_SmallFile(t *testing.T) {
	fv := CodeFileView("local/main.go", []byte("package main"), "go", 1024)
	if fv.Kind != "code" {
		t.Fatalf("Kind = %q, want code", fv.Kind)
	}
	if fv.Language != "go" || fv.Body != "package main" {
		t.Fatalf("unexpected %+v", fv)
	}
	if fv.TooLargeToHighlight {
		t.Fatal("small file must not be flagged too large")
	}
	if fv.Title != "main.go" {
		t.Fatalf("Title = %q, want main.go", fv.Title)
	}
	if fv.Headings == nil || fv.Frontmatter == nil {
		t.Fatal("Headings/Frontmatter must be non-nil (empty) to avoid JSON null")
	}
}

func TestCodeFileView_TooLarge(t *testing.T) {
	big := strings.Repeat("x", 2048)
	fv := CodeFileView("local/big.log", []byte(big), "", 1024)
	if !fv.TooLargeToHighlight {
		t.Fatal("file over cap must be flagged")
	}
	if fv.Body != big {
		t.Fatal("body must still carry the full raw content")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/render/ -run TestCodeFileView -v`
Expected: FAIL — `undefined: CodeFileView`.

- [ ] **Step 3: Implement**

In `internal/render/render.go`, extend the struct:
```go
type FileView struct {
	Path                string         `json:"path"`
	Title               string         `json:"title"`
	Frontmatter         map[string]any `json:"frontmatter"`
	Body                string         `json:"body"`
	Headings            []Heading      `json:"headings"`
	IsAIContext         bool           `json:"is_ai_context"`
	Kind                string         `json:"kind"`
	Language            string         `json:"language,omitempty"`
	TooLargeToHighlight bool           `json:"tooLargeToHighlight,omitempty"`
}
```

Add (import `path` at top of render.go if not present):
```go
// CodeFileView builds the view for a non-markdown text file: raw content plus a
// highlight language. Over maxBytes it keeps the full body but signals the
// client to skip (expensive) highlighting and show plaintext.
func CodeFileView(p string, raw []byte, language string, maxBytes int) FileView {
	return FileView{
		Path:                p,
		Title:               path.Base(p),
		Frontmatter:         map[string]any{},
		Body:                string(raw),
		Headings:            []Heading{},
		Kind:                "code",
		Language:            language,
		TooLargeToHighlight: len(raw) > maxBytes,
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/render/ -run TestCodeFileView -v`
Expected: PASS

- [ ] **Step 5: gofmt + commit**

```bash
gofmt -w internal/render/
git add internal/render/render.go internal/render/code_test.go
git commit -m "feat: FileView code fields + render.CodeFileView

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

### Task 4: `handleFile` branches doc vs code

**Files:**
- Modify: `internal/api/workspace_handlers.go` (`handleFile`, ~lines 40-68)
- Create: `internal/api/file_code_test.go`

**Interfaces:**
- Consumes: `source.Classify`, `source.HighlightLanguage`, `render.CodeFileView`.
- Produces: `GET /api/workspaces/:id/file/*path` returns `kind:"markdown"` for docs, `kind:"code"` for text files.

- [ ] **Step 1: Write the failing test**

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
)

func newCodeApp(t *testing.T) *app.App {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "guide.md"), []byte("# Guide\nhi"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte("package main"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Server:     config.ServerConfig{Addr: ":0"},
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{{ID: "ws", Name: "WS", Sources: []config.Source{
			{ID: "local", Type: "local", Path: dir},
		}}},
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

func TestAPI_File_CodeKind(t *testing.T) {
	a := newCodeApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/file/local/main.go")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var fv struct {
		Kind, Language, Body string
	}
	json.NewDecoder(resp.Body).Decode(&fv)
	if fv.Kind != "code" || fv.Language != "go" || fv.Body != "package main" {
		t.Fatalf("got %+v, want code/go/package main", fv)
	}
}

func TestAPI_File_MarkdownKind(t *testing.T) {
	a := newCodeApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/file/local/guide.md")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var fv struct{ Kind string }
	json.NewDecoder(resp.Body).Decode(&fv)
	if fv.Kind != "markdown" {
		t.Fatalf("Kind = %q, want markdown", fv.Kind)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/api/ -run 'TestAPI_File_(Code|Markdown)Kind' -v`
Expected: FAIL — code file returns markdown-parsed body (Kind empty).

- [ ] **Step 3: Implement** — in `handleFile`, after `raw, err := src.Read(...)` and the not-found check, branch. Replace the existing block that does `doc := index.Parse(...)` through the `c.JSON(...)` with:

```go
		base := filepath.Base(relPath)
		if source.Classify(base) != source.ClassDoc {
			c.JSON(http.StatusOK, render.CodeFileView(
				path, raw, source.HighlightLanguage(base), maxHighlightBytes))
			return
		}
		doc := index.Parse(raw, base)
		body := a.PlantUML.RenderBlocks(c.Request.Context(), doc.Body)
		c.JSON(http.StatusOK, render.FileView{
			Path: path, Title: doc.Title, Frontmatter: doc.Frontmatter, Body: body,
			Headings: render.ExtractHeadings(doc.Body), IsAIContext: index.IsAIContextFile(relPath),
			Kind: "markdown",
		})
```

Add `source` to the import block if not present, and define the constant near the top of the file (package level):
```go
const maxHighlightBytes = 1 << 20 // 1 MiB — above this, serve raw, don't highlight
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/api/ -run 'TestAPI_File_' -v`
Expected: PASS

- [ ] **Step 5: gofmt + commit**

```bash
gofmt -w internal/api/
git add internal/api/workspace_handlers.go internal/api/file_code_test.go
git commit -m "feat: serve code files as kind:code from the file API

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

### Task 5: Static build emits code file views

**Files:**
- Modify: `internal/staticbuild/build.go` (per-leaf loop, ~lines 68-94)
- Modify: `internal/staticbuild/build_test.go` (if present) or Create: `internal/staticbuild/build_code_test.go`

**Interfaces:**
- Consumes: `source.IsIndexed`, `source.HighlightLanguage`, `render.CodeFileView`.
- Produces: `data/files/<path>.json` for code files with `kind:"code"`; code files are absent from `search-index.json`.

- [ ] **Step 1: Write the failing test** — build an export from a temp workspace with a code file, assert its JSON is `kind:"code"` and it's not in the search index.

```go
package staticbuild

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestBuild_CodeFileEmittedNotIndexed(t *testing.T) {
	out := buildFixture(t, map[string]string{
		"guide.md": "# Guide\nhello",
		"main.go":  "package main",
	})

	var fv struct{ Kind, Language string }
	readJSON(t, filepath.Join(out, "data", "files", "local", "main.go.json"), &fv)
	if fv.Kind != "code" || fv.Language != "go" {
		t.Fatalf("main.go.json = %+v, want code/go", fv)
	}

	var idx []map[string]any
	readJSON(t, filepath.Join(out, "data", "search-index.json"), &idx)
	for _, r := range idx {
		if r["path"] == "main.go" {
			t.Fatal("code file must not be in the search index")
		}
	}
}

func readJSON(t *testing.T, p string, v any) {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}
```

> Reuse the existing test's workspace-builder if `build_test.go` already has one; otherwise add `buildFixture(t, files) (outDir string)` that writes `files` into a temp local source, constructs a `config.Config` with workspace `example`/source `local` (mirroring `newCodeApp` in Task 4), calls `app.New` + `Build(ctx, app, Options{WorkspaceID:"example", OutDir:t.TempDir()})`. Check `internal/staticbuild/build.go` for the exact `Build`/`Options` signature and copy it.

- [ ] **Step 2: Run test to verify it fails**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/staticbuild/ -run TestBuild_CodeFile -v`
Expected: FAIL — `main.go.json` is markdown-parsed (Kind empty) or missing.

- [ ] **Step 3: Implement** — in the per-leaf loop of `Build`, wrap the existing doc body with a branch. Replace from `doc := index.Parse(...)` through the search-index append with:

```go
		if !source.IsIndexed(relPath) {
			fv := render.CodeFileView(path, raw, source.HighlightLanguage(filepath.Base(relPath)), 1<<20)
			if err := writeJSON(filepath.Join(opts.OutDir, "data", "files", path+".json"), fv); err != nil {
				return fmt.Errorf("build: write file json %s: %w", path, err)
			}
			continue
		}
		doc := index.Parse(raw, filepath.Base(relPath))
		body := a.PlantUML.RenderBlocks(ctx, doc.Body)
		isAI := index.IsAIContextFile(relPath)
		fv := render.FileView{
			Path: path, Title: doc.Title, Frontmatter: doc.Frontmatter, Body: body,
			Headings: render.ExtractHeadings(doc.Body), IsAIContext: isAI, Kind: "markdown",
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
```

> The `continue` skips the git-history block below for code files. If code files should still get git history in the export, move the git block above this branch instead. For v1, skipping is fine (history panel is a live-only nicety in export). Ensure `source` is imported.

- [ ] **Step 4: Run test to verify it passes**

Run: `CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/staticbuild/ -run TestBuild_CodeFile -v`
Expected: PASS

- [ ] **Step 5: gofmt + commit**

```bash
gofmt -w internal/staticbuild/
git add internal/staticbuild/
git commit -m "feat: static export emits kind:code views, skips code in search index

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

### Task 6: Frontend `CodeView` + lazy highlighter

**Files:**
- Modify: `web/src/datasource/types.ts` (`FileView` interface, ~lines 8-15)
- Create: `web/src/highlight.ts`
- Create: `web/src/components/CodeView.tsx`
- Create: `web/src/components/CodeView.test.tsx`
- Modify: `web/src/styles.css` (append)
- Modify: `web/package.json` (add `highlight.js`)

**Interfaces:**
- Consumes: `FileView.kind/language/tooLargeToHighlight` from the API.
- Produces: `<CodeView body language tooLargeToHighlight />`, default export none; `highlightCode(code, language): Promise<string | null>` in `highlight.ts` (returns highlighted HTML, or `null` when unsupported → caller shows escaped plaintext).

- [ ] **Step 1: Install the dependency**

```bash
cd /home/minhtuan/dev/local/dmox/web && npm install highlight.js
```

- [ ] **Step 2: Extend the `FileView` type** in `web/src/datasource/types.ts`:

```ts
export interface FileView {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  headings: { level: number; text: string; slug: string }[];
  is_ai_context: boolean;
  kind: 'markdown' | 'code';
  language?: string;
  tooLargeToHighlight?: boolean;
}
```

(No datasource code changes: both `getFile` impls already return the parsed JSON as `FileView`, so the new fields flow through.)

- [ ] **Step 3: Write the failing test** for `CodeView`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CodeView } from './CodeView';

describe('CodeView', () => {
  it('renders one gutter number per line', () => {
    const { container } = render(<CodeView body={'a\nb\nc'} language="go" />);
    expect(container.querySelectorAll('.code-line-no')).toHaveLength(3);
  });

  it('shows a banner and skips highlighting for oversized files', () => {
    const { container, getByText } = render(
      <CodeView body={'x'} language="go" tooLargeToHighlight />
    );
    expect(getByText(/highlight/i)).toBeInTheDocument();
    // plaintext: no hljs markup
    expect(container.querySelector('.hljs')).toBeNull();
  });

  it('does not remount its <pre> when the parent re-renders', () => {
    const { container, rerender } = render(<CodeView body={'a\nb'} language="go" />);
    const first = container.querySelector('pre');
    rerender(<CodeView body={'a\nb'} language="go" />);
    expect(container.querySelector('pre')).toBe(first);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run src/components/CodeView.test.tsx`
Expected: FAIL — cannot resolve `./CodeView`.

- [ ] **Step 5: Implement `highlight.ts`**

```ts
// Lazy wrapper around highlight.js so it lands in its own chunk, loaded only
// when the first code file is opened.
export async function highlightCode(code: string, language: string): Promise<string | null> {
  const { default: hljs } = await import('highlight.js/lib/common');
  if (!language || !hljs.getLanguage(language)) return null;
  try {
    return hljs.highlight(code, { language }).value;
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Implement `CodeView.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { highlightCode } from '../highlight';

function LineGutter({ count }: { count: number }) {
  const nums = useMemo(() => Array.from({ length: count }, (_, i) => i + 1), [count]);
  return (
    <div className="code-gutter" aria-hidden="true">
      {nums.map((n) => (
        <span key={n} className="code-line-no">
          {n}
        </span>
      ))}
    </div>
  );
}

export function CodeView({
  body,
  language = '',
  tooLargeToHighlight = false,
}: {
  body: string;
  language?: string;
  tooLargeToHighlight?: boolean;
}) {
  const lineCount = useMemo(() => (body.length ? body.split('\n').length : 0), [body]);
  const [html, setHtml] = useState<string | null>(null);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let alive = true;
    setHtml(null);
    if (tooLargeToHighlight || !language) return;
    highlightCode(body, language).then((h) => {
      if (alive) setHtml(h);
    });
    return () => {
      alive = false;
    };
  }, [body, language, tooLargeToHighlight]);

  const copy = () => navigator.clipboard?.writeText(body);

  return (
    <div className="code-view">
      <div className="code-toolbar">
        {language && <span className="code-lang">{language}</span>}
        <button type="button" className="code-copy" onClick={copy}>
          Copy
        </button>
      </div>
      {tooLargeToHighlight && (
        <p className="code-banner">Large file — syntax highlighting is off.</p>
      )}
      <div className="code-body">
        <LineGutter count={lineCount} />
        <pre className="code-pre">
          {html !== null ? (
            <code ref={codeRef} className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <code ref={codeRef}>{body}</code>
          )}
        </pre>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Append styles** to `web/src/styles.css`:

```css
.code-view { display: flex; flex-direction: column; }
.code-toolbar { display: flex; align-items: center; gap: 8px; justify-content: flex-end; padding: 4px 0; }
.code-lang { font-size: 12px; opacity: 0.6; text-transform: uppercase; margin-right: auto; }
.code-copy { font-size: 12px; cursor: pointer; }
.code-banner { font-size: 13px; opacity: 0.8; margin: 4px 0; }
.code-body { display: flex; overflow-x: auto; border: 1px solid rgba(128,128,128,0.25); border-radius: 6px; }
.code-gutter { display: flex; flex-direction: column; text-align: right; padding: 12px 8px; user-select: none; opacity: 0.45; border-right: 1px solid rgba(128,128,128,0.25); }
.code-line-no { font-variant-numeric: tabular-nums; font-family: monospace; line-height: 1.5; font-size: 13px; }
.code-pre { margin: 0; padding: 12px; overflow: visible; }
.code-pre code { font-family: monospace; line-height: 1.5; font-size: 13px; white-space: pre; }
```

- [ ] **Step 8: Run tests + typecheck**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run src/components/CodeView.test.tsx && npx tsc -b --force`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
cd /home/minhtuan/dev/local/dmox
git add web/src/datasource/types.ts web/src/highlight.ts web/src/components/CodeView.tsx web/src/components/CodeView.test.tsx web/src/styles.css web/package.json web/package-lock.json
git commit -m "feat: CodeView with line numbers, copy, lazy highlight.js

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

### Task 7: Wire `FileViewerPage` to branch on `kind`

**Files:**
- Modify: `web/src/routes/FileViewerPage.tsx` (the render region, ~line 173)
- Modify: `web/src/routes/FileViewerPage.test.tsx` (if present) or Create: `web/src/routes/FileViewerPage.code.test.tsx`

**Interfaces:**
- Consumes: `FileView.kind`, `CodeView`.
- Produces: code files render via `CodeView`, markdown via `MarkdownView`.

- [ ] **Step 1: Write the failing test** — a datasource returning `kind:"code"` renders CodeView.

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { FileViewerPage } from './FileViewerPage';
import * as ctx from '../datasource/context';

function mount(file: any) {
  vi.spyOn(ctx, 'useDataSource').mockReturnValue({
    getFile: vi.fn().mockResolvedValue(file),
    getGitHistory: vi.fn().mockResolvedValue({ available: false, commits: [] }),
  } as any);
  return render(
    <MemoryRouter initialEntries={['/w/ws/doc/local/main.go']}>
      <Routes>
        <Route path="/w/:workspaceId/doc/*" element={<FileViewerPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('FileViewerPage kind branching', () => {
  it('renders CodeView for kind:code', async () => {
    const { container } = mount({
      path: 'local/main.go', title: 'main.go', body: 'package main\nfunc main(){}',
      frontmatter: {}, headings: [], is_ai_context: false, kind: 'code', language: 'go',
    });
    await waitFor(() => expect(container.querySelector('.code-view')).toBeInTheDocument());
  });
});
```

> Match the existing `FileViewerPage.test.tsx` mocking style if it differs (it may mock the datasource module differently); mirror that file's setup rather than the sketch above.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run src/routes/FileViewerPage.code.test.tsx`
Expected: FAIL — renders MarkdownView (no `.code-view`).

- [ ] **Step 3: Implement** — in `FileViewerPage.tsx`, import `CodeView` and replace the single `<MarkdownView .../>` render line with a branch:

```tsx
      {file.kind === 'code' ? (
        <CodeView body={file.body} language={file.language} tooLargeToHighlight={file.tooLargeToHighlight} />
      ) : (
        <MarkdownView body={file.body} workspaceId={workspaceId} currentPath={wildcardPath} />
      )}
```

Add `import { CodeView } from '../components/CodeView';` near the `MarkdownView` import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run src/routes/FileViewerPage.code.test.tsx`
Expected: PASS

- [ ] **Step 5: Full frontend gate + commit**

Run: `cd /home/minhtuan/dev/local/dmox/web && npx vitest run && npx tsc -b --force`
Expected: all PASS, no type errors.

```bash
cd /home/minhtuan/dev/local/dmox
git add web/src/routes/FileViewerPage.tsx web/src/routes/FileViewerPage.code.test.tsx
git commit -m "feat: render code files via CodeView in FileViewerPage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

### Task 8: Full build, real-app verification, docs

**Files:**
- Modify: `docs/roadmap/2026-07-20-technical-backlog.md` (#7 status + table)
- Modify: `CLAUDE.md` (one note if a non-obvious constraint surfaced)

- [ ] **Step 1: Full build + full test suite**

Run:
```bash
cd /home/minhtuan/dev/local/dmox
make build-frontend
CGO_ENABLED=1 go test -tags sqlite_fts5 ./...
cd web && npx vitest run && npx tsc -b --force
gofmt -l . 
```
Expected: backend PASS, vitest PASS, tsc clean, `gofmt -l .` prints nothing.

- [ ] **Step 2: Real-app smoke** — run `./bin/dmox serve` against a workspace containing a `.go`/`.yml` and a `>1MB` file. Confirm in the browser: (a) a code file opens with line numbers + highlight + Copy; (b) a `.md` still renders as before; (c) the big file shows the banner and does not hang; (d) scrolling a highlighted file and triggering a re-render does NOT jump to top (the MarkdownView remount class of bug). Capture a screenshot of a code file.

- [ ] **Step 3: Update the backlog** — flip #7 to 🟢 in the status table and the section, noting anything found only by running it (per project convention). If diagram files or large files revealed a real constraint, record it.

- [ ] **Step 4: Commit docs**

```bash
git add docs/roadmap/2026-07-20-technical-backlog.md CLAUDE.md
git commit -m "docs: mark backlog #7 (General File Viewer) done

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qr33dRAHBGfG71bGnY4ah8"
```

---

## Self-Review

**Spec coverage:**
- §3.1 Classify (doc/text/unsupported) → Task 1. Call-site migration + index guard → Task 2. ✓
- §3.2 handleFile branch + FileView fields + cap → Tasks 3, 4. ✓
- §3.3 CodeView (line numbers, copy, lazy highlight, banner, referential-stable), kind branch, Ctrl+F native (no code) → Tasks 6, 7. ✓
- §3.4 static build → Task 5. ✓
- §5 testing (Classify table, List, handleFile, index-skip regression, CodeView no-remount, both datasources) → Tasks 1,2,4,5,6,7. ✓ (static getFile pass-through covered by the type change + Task 5 export test.)
- §6 out-of-scope (tabs, minimap, diagram render, code-in-index, search overlay, rst/adoc rich) → not implemented, by design. ✓

**Placeholder scan:** Tasks 5 and 7 contain "mirror the existing test helper/mocking style" notes rather than fully-copied fixtures, because the exact existing helper (`buildFixture`, `FileViewerPage.test.tsx` mock shape) must be read at execution time; the sketch plus the Task 4 `newCodeApp` reference give a complete fallback. Acceptable — flagged explicitly, not a silent TODO.

**Type consistency:** `FileClass`/`Classify`/`IsViewable`/`IsIndexed`/`HighlightLanguage` (Task 1) used verbatim in Tasks 2/4/5. `render.CodeFileView(p, raw, language, maxBytes)` (Task 3) called identically in Tasks 4/5. `FileView.kind/language/tooLargeToHighlight` (Go tags `kind`/`language`/`tooLargeToHighlight`) match the TS interface (Task 6) and the `CodeView` props (Tasks 6/7). ✓
