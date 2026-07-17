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
