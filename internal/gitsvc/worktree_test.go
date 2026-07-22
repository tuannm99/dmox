package gitsvc

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"
)

func initRepo(t *testing.T) (dir string, repo *git.Repository) {
	t.Helper()
	dir = t.TempDir()
	repo, err := git.PlainInit(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	return dir, repo
}

func write(t *testing.T, dir, rel, content string) string {
	t.Helper()
	full := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return full
}

func commitAll(t *testing.T, repo *git.Repository, msg string) {
	t.Helper()
	wt, err := repo.Worktree()
	if err != nil {
		t.Fatal(err)
	}
	if err := wt.AddGlob("."); err != nil {
		t.Fatal(err)
	}
	_, err = wt.Commit(msg, &git.CommitOptions{
		Author: &object.Signature{Name: "T", Email: "t@example.com", When: time.Now()},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func statusOf(t *testing.T, st WorkingTreeStatus, path string) FileStatus {
	t.Helper()
	for _, f := range st.Files {
		if f.Path == path {
			return f
		}
	}
	t.Fatalf("no status for %q in %+v", path, st.Files)
	return FileStatus{}
}

func TestWorkingTree_NotARepository(t *testing.T) {
	st, err := New().WorkingTree(t.TempDir())
	if err != nil {
		t.Fatalf("a plain directory is an ordinary state, not an error: %v", err)
	}
	if st.Applicable {
		t.Error("want applicable=false outside a repository")
	}
	if st.Files == nil {
		t.Error("want an empty slice, not nil, so the JSON is [] rather than null")
	}
}

func TestWorkingTree_BranchAndFileStatuses(t *testing.T) {
	dir, repo := initRepo(t)
	write(t, dir, "docs/a.md", "one\n")
	write(t, dir, "docs/gone.md", "bye\n")
	commitAll(t, repo, "init")

	write(t, dir, "docs/a.md", "one\ntwo\n")              // modified
	write(t, dir, "docs/fresh.md", "new\n")               // untracked
	os.Remove(filepath.Join(dir, "docs", "gone.md"))      // deleted
	write(t, dir, "elsewhere.md", "outside the source\n") // must not be reported

	st, err := New().WorkingTree(filepath.Join(dir, "docs"))
	if err != nil {
		t.Fatal(err)
	}
	if !st.Applicable {
		t.Fatal("want applicable=true inside a checkout")
	}
	if st.Branch == "" || st.Detached {
		t.Errorf("want a named branch, got %q detached=%v", st.Branch, st.Detached)
	}
	if got := statusOf(t, st, "a.md").Status; got != "modified" {
		t.Errorf("a.md: got %q, want modified", got)
	}
	if got := statusOf(t, st, "fresh.md").Status; got != "untracked" {
		t.Errorf("fresh.md: got %q, want untracked", got)
	}
	if got := statusOf(t, st, "gone.md").Status; got != "deleted" {
		t.Errorf("gone.md: got %q, want deleted", got)
	}
	for _, f := range st.Files {
		if f.Path == "elsewhere.md" || f.Path == "../elsewhere.md" {
			t.Errorf("a file outside the source directory leaked in: %+v", f)
		}
	}
}

func TestWorkingTree_ReportsStagedSeparately(t *testing.T) {
	dir, repo := initRepo(t)
	write(t, dir, "a.md", "one\n")
	commitAll(t, repo, "init")

	write(t, dir, "a.md", "one\ntwo\n")
	wt, err := repo.Worktree()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := wt.Add("a.md"); err != nil {
		t.Fatal(err)
	}

	st, err := New().WorkingTree(dir)
	if err != nil {
		t.Fatal(err)
	}
	f := statusOf(t, st, "a.md")
	if !f.Staged {
		t.Errorf("want staged=true after git add, got %+v", f)
	}
	if f.Status != "modified" {
		t.Errorf("want modified, got %q", f.Status)
	}
}

func TestWorkingTree_CachesUntilInvalidated(t *testing.T) {
	dir, repo := initRepo(t)
	write(t, dir, "a.md", "one\n")
	commitAll(t, repo, "init")

	svc := New()
	if st, _ := svc.WorkingTree(dir); len(st.Files) != 0 {
		t.Fatalf("want a clean tree to start, got %+v", st.Files)
	}

	write(t, dir, "a.md", "changed\n")
	if st, _ := svc.WorkingTree(dir); len(st.Files) != 0 {
		t.Errorf("want the cached (clean) result, got %+v", st.Files)
	}

	svc.InvalidateWorkingTree(dir)
	st, _ := svc.WorkingTree(dir)
	if got := statusOf(t, st, "a.md").Status; got != "modified" {
		t.Errorf("after invalidation: got %q, want modified", got)
	}
}

func TestWorkingTreeDiff(t *testing.T) {
	dir, repo := initRepo(t)
	write(t, dir, "docs/a.md", "one\n")
	commitAll(t, repo, "init")
	write(t, dir, "docs/a.md", "one\ntwo\n")
	write(t, dir, "docs/fresh.md", "brand new\n")

	svc := New()
	docs := filepath.Join(dir, "docs")

	d, err := svc.WorkingTreeDiff(docs, "a.md")
	if err != nil {
		t.Fatal(err)
	}
	if !d.Available || d.Old != "one\n" || d.New != "one\ntwo\n" {
		t.Errorf("modified file: got %+v", d)
	}

	// An untracked file has nothing committed to compare against — that is an
	// empty "before", not an error.
	d, err = svc.WorkingTreeDiff(docs, "fresh.md")
	if err != nil {
		t.Fatal(err)
	}
	if !d.Available || d.Old != "" || d.New != "brand new\n" {
		t.Errorf("untracked file: got %+v", d)
	}

	// Deleted on disk: the committed side survives, the new side is empty.
	os.Remove(filepath.Join(docs, "a.md"))
	d, err = svc.WorkingTreeDiff(docs, "a.md")
	if err != nil {
		t.Fatal(err)
	}
	if !d.Available || d.Old != "one\n" || d.New != "" {
		t.Errorf("deleted file: got %+v", d)
	}
}

func TestWorkingTreeDiff_NotARepository(t *testing.T) {
	d, err := New().WorkingTreeDiff(t.TempDir(), "a.md")
	if err != nil {
		t.Fatal(err)
	}
	if d.Available {
		t.Errorf("want available=false outside a repository, got %+v", d)
	}
}
