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
