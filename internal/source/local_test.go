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

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
