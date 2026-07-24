package source

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLocalSource_SyncListRead(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "guide.md"), "# Guide\nhello")
	mustWrite(t, filepath.Join(dir, "sub", "nested.md"), "# Nested")
	mustWrite(t, filepath.Join(dir, "code.go"), "package main")
	mustWrite(t, filepath.Join(dir, "logo.png"), "not viewable")

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
	if !paths["guide.md"] || !paths["sub/nested.md"] || !paths["code.go"] {
		t.Fatalf("List missing expected files: %+v", files)
	}
	if paths["logo.png"] {
		t.Fatalf("List should not include unviewable files: %+v", files)
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

func TestLocalSource_ListRespectsGitignore(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "README.md"), "# Readme")
	mustWrite(t, filepath.Join(dir, "src", "main.go"), "package main")
	mustWrite(t, filepath.Join(dir, "node_modules", "dep", "index.js"), "console.log(1)")
	mustWrite(t, filepath.Join(dir, "dist", "out.js"), "console.log(2)")
	mustWrite(t, filepath.Join(dir, ".gitignore"), "node_modules/\ndist/\n")

	s := NewLocalSource("local", dir)
	files, err := s.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	paths := map[string]bool{}
	for _, f := range files {
		paths[f.Path] = true
	}
	if !paths["README.md"] || !paths["src/main.go"] {
		t.Fatalf("List missing expected files: %+v", files)
	}
	for p := range paths {
		if strings.HasPrefix(p, "node_modules/") || strings.HasPrefix(p, "dist/") {
			t.Fatalf("List should not include ignored file %q: %+v", p, files)
		}
	}
}

func TestLocalSource_ListRespectsNestedGitignore(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "sub", ".gitignore"), "ignored.txt\n")
	mustWrite(t, filepath.Join(dir, "sub", "ignored.txt"), "secret")
	mustWrite(t, filepath.Join(dir, "sub", "keep.md"), "# Keep")

	s := NewLocalSource("local", dir)
	files, err := s.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	paths := map[string]bool{}
	for _, f := range files {
		paths[f.Path] = true
	}
	if paths["sub/ignored.txt"] {
		t.Fatalf("List should not include nested-gitignored file: %+v", files)
	}
	if !paths["sub/keep.md"] {
		t.Fatalf("List missing sub/keep.md: %+v", files)
	}
}

func TestLocalSource_ListNoGitignoreIsUnaffected(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "one.md"), "# One")
	mustWrite(t, filepath.Join(dir, "two.md"), "# Two")

	s := NewLocalSource("local", dir)
	files, err := s.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	paths := map[string]bool{}
	for _, f := range files {
		paths[f.Path] = true
	}
	if !paths["one.md"] || !paths["two.md"] {
		t.Fatalf("List missing expected files with no .gitignore present: %+v", files)
	}
}

// TestLocalSource_WatchIgnoresPreexistingIgnoredDir covers addRecursive's
// initial walk: a directory matched by .gitignore that already exists before
// Watch starts must never get an fsnotify watch registered on it.
func TestLocalSource_WatchIgnoresPreexistingIgnoredDir(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ".gitignore"), "node_modules/\n")
	mustWrite(t, filepath.Join(dir, "node_modules", "dep", "placeholder.txt"), "placeholder")
	mustWrite(t, filepath.Join(dir, "docs", "readme.md"), "# Readme")

	s := NewLocalSource("local", dir)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	events, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("Watch: %v", err)
	}
	time.Sleep(50 * time.Millisecond) // let the watcher subscribe before the write

	mustWrite(t, filepath.Join(dir, "node_modules", "dep", "index.js"), "console.log(1)")
	assertNoEventWithPrefix(t, events, "node_modules/", 1500*time.Millisecond)

	// Positive control: the watcher must still be alive and reporting
	// non-ignored changes, so the absence above isn't a vacuous pass.
	mustWrite(t, filepath.Join(dir, "docs", "new.md"), "# New")
	assertEventForPath(t, events, "docs/new.md", 3*time.Second)
}

// TestLocalSource_WatchIgnoresNewlyCreatedIgnoredDir covers the runtime path:
// debounceWatch reacts to an fsnotify Create event for a brand-new directory
// by calling addRecursive again. That re-walk must resolve paths against the
// fixed source root (not the newly created directory) so the existing
// .gitignore patterns still apply to directories created after Watch starts.
func TestLocalSource_WatchIgnoresNewlyCreatedIgnoredDir(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ".gitignore"), "node_modules/\n")
	mustWrite(t, filepath.Join(dir, "docs", "readme.md"), "# Readme")

	s := NewLocalSource("local", dir)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	events, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("Watch: %v", err)
	}
	time.Sleep(50 * time.Millisecond) // let the watcher subscribe before the write

	// node_modules/ does not exist yet at Watch time - it is created now,
	// after the watcher is already running.
	mustWrite(t, filepath.Join(dir, "node_modules", "dep", "index.js"), "console.log(1)")
	assertNoEventWithPrefix(t, events, "node_modules/", 1500*time.Millisecond)

	// Positive control.
	mustWrite(t, filepath.Join(dir, "docs", "new.md"), "# New")
	assertEventForPath(t, events, "docs/new.md", 3*time.Second)
}

// TestLocalSource_WatchSkipsNewlyCreatedDotDir locks in the current dot-dir
// guard behavior in the runtime re-walk: a top-level dot-directory created
// after Watch starts is skipped like everywhere else, rather than being
// self-exempted and watched.
func TestLocalSource_WatchSkipsNewlyCreatedDotDir(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "docs", "readme.md"), "# Readme")

	s := NewLocalSource("local", dir)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	events, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("Watch: %v", err)
	}
	time.Sleep(50 * time.Millisecond) // let the watcher subscribe before the write

	mustWrite(t, filepath.Join(dir, ".hidden", "file.txt"), "secret")
	assertNoEventWithPrefix(t, events, ".hidden/", 1500*time.Millisecond)

	// Positive control.
	mustWrite(t, filepath.Join(dir, "docs", "new.md"), "# New")
	assertEventForPath(t, events, "docs/new.md", 3*time.Second)
}

// assertNoEventWithPrefix drains events for wait, failing the test if any
// event's path has the given prefix. Events not matching the prefix are
// drained and ignored so the wait runs to completion.
func assertNoEventWithPrefix(t *testing.T, events <-chan ChangeEvent, prefix string, wait time.Duration) {
	t.Helper()
	deadline := time.After(wait)
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				return
			}
			if strings.HasPrefix(ev.Path, prefix) {
				t.Fatalf("unexpected change event for ignored path: %+v", ev)
			}
		case <-deadline:
			return
		}
	}
}

// assertEventForPath waits up to timeout for a ChangeEvent matching path,
// draining and ignoring any other events in the meantime.
func assertEventForPath(t *testing.T, events <-chan ChangeEvent, path string, timeout time.Duration) {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				t.Fatalf("event channel closed while waiting for change event on %q", path)
			}
			if ev.Path == path {
				return
			}
		case <-deadline:
			t.Fatalf("timed out waiting for change event on %q", path)
		}
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
