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
