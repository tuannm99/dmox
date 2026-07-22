package gitsvc

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// WorkingTreeStatus is the state of the git checkout a *local* source lives
// in. This is the mirror image of History/Blame above: those read a
// GitSource's mirrored clone, which is bare-ish and has no working tree,
// while this only means anything for a LocalSource that happens to sit inside
// a real checkout. Either can legitimately be inapplicable, which is reported
// rather than treated as an error.
type WorkingTreeStatus struct {
	Applicable bool         `json:"applicable"`
	Branch     string       `json:"branch"`
	Detached   bool         `json:"detached"`
	Files      []FileStatus `json:"files"`
}

type FileStatus struct {
	// Path is relative to the source root, slash-separated, so it lines up
	// with the paths the doc tree uses.
	Path   string `json:"path"`
	Status string `json:"status"`
	Staged bool   `json:"staged"`
}

// WorkingTreeDiff is the on-disk content of a file next to its committed
// version. Deliberately the same shape the live-reload diff already returns,
// so the frontend renders both through one DiffModal.
type WorkingTreeDiff struct {
	Available bool   `json:"available"`
	Old       string `json:"old"`
	New       string `json:"new"`
}

func statusName(code git.StatusCode) string {
	switch code {
	case git.Untracked:
		return "untracked"
	case git.Modified:
		return "modified"
	case git.Added:
		return "added"
	case git.Deleted:
		return "deleted"
	case git.Renamed:
		return "renamed"
	case git.Copied:
		return "copied"
	case git.UpdatedButUnmerged:
		return "conflicted"
	default:
		return ""
	}
}

// openWorkingTree finds the checkout containing dir, walking up for a .git the
// way git itself does — a source usually points at a subdirectory (docs/) of a
// repo, not its root. Returns ok=false, and no error, when dir simply isn't in
// a repository: that is an ordinary state, not a failure.
func openWorkingTree(dir string) (repo *git.Repository, wt *git.Worktree, prefix string, ok bool, err error) {
	repo, err = git.PlainOpenWithOptions(dir, &git.PlainOpenOptions{DetectDotGit: true})
	if err != nil {
		if errors.Is(err, git.ErrRepositoryNotExists) {
			return nil, nil, "", false, nil
		}
		return nil, nil, "", false, fmt.Errorf("open repo: %w", err)
	}
	wt, err = repo.Worktree()
	if err != nil {
		// A bare repository has no working tree — nothing to report on.
		if errors.Is(err, git.ErrIsBareRepository) {
			return nil, nil, "", false, nil
		}
		return nil, nil, "", false, fmt.Errorf("worktree: %w", err)
	}

	// go-git reports paths relative to the repo root; the caller wants them
	// relative to the source directory.
	root, err := filepath.Abs(wt.Filesystem.Root())
	if err != nil {
		return nil, nil, "", false, err
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, nil, "", false, err
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil || strings.HasPrefix(rel, "..") {
		return nil, nil, "", false, nil
	}
	if rel == "." {
		rel = ""
	}
	return repo, wt, filepath.ToSlash(rel), true, nil
}

// go-git's Status() hashes the entire working tree — measured at ~2s on a
// mid-sized repo — which is far too slow to run on every request that wants a
// status badge. Results are cached per directory and dropped as soon as the
// file watcher reports a change under that source (see watchAndReindex), so
// the common case is instant and still current. The TTL is the backstop for
// changes the watcher cannot see, chiefly `git checkout` of another branch:
// that happens inside .git, which isn't watched.
const workingTreeTTL = 10 * time.Second

type wtEntry struct {
	mu    sync.Mutex
	valid bool
	at    time.Time
	st    WorkingTreeStatus
}

func (s *Service) entry(dir string) *wtEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.wt == nil {
		s.wt = make(map[string]*wtEntry)
	}
	e, ok := s.wt[dir]
	if !ok {
		e = &wtEntry{}
		s.wt[dir] = e
	}
	return e
}

// InvalidateWorkingTree drops any cached status for dir. Safe to call for a
// directory that was never queried.
func (s *Service) InvalidateWorkingTree(dir string) {
	e := s.entry(dir)
	e.mu.Lock()
	e.valid = false
	e.mu.Unlock()
}

// WorkingTree reports the branch and per-file status of the checkout
// containing dir, restricted to files under dir itself.
func (s *Service) WorkingTree(dir string) (WorkingTreeStatus, error) {
	e := s.entry(dir)
	// Held across the computation so a burst of concurrent requests for the
	// same directory costs one scan, not one each.
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.valid && time.Since(e.at) < workingTreeTTL {
		return e.st, nil
	}
	st, err := s.computeWorkingTree(dir)
	if err != nil {
		return WorkingTreeStatus{}, err
	}
	e.st, e.at, e.valid = st, time.Now(), true
	return st, nil
}

func (s *Service) computeWorkingTree(dir string) (WorkingTreeStatus, error) {
	repo, wt, prefix, ok, err := openWorkingTree(dir)
	if err != nil {
		return WorkingTreeStatus{}, err
	}
	if !ok {
		return WorkingTreeStatus{Files: []FileStatus{}}, nil
	}

	out := WorkingTreeStatus{Applicable: true, Files: []FileStatus{}}
	if head, err := repo.Head(); err == nil {
		if head.Name().IsBranch() {
			out.Branch = head.Name().Short()
		} else {
			out.Detached = true
			out.Branch = head.Hash().String()[:7]
		}
	}
	// An empty repository has no HEAD yet; that is not an error, there is
	// simply no branch to name.

	status, err := wt.Status()
	if err != nil {
		return WorkingTreeStatus{}, fmt.Errorf("status: %w", err)
	}
	for path, fs := range status {
		rel, inside := relativeTo(prefix, filepath.ToSlash(path))
		if !inside {
			continue
		}
		// Staged wins the label: it is the more specific fact, and a file can
		// legitimately be both (staged edit plus a further unstaged one).
		code, staged := fs.Staging, true
		if code == git.Unmodified || code == git.Untracked {
			code, staged = fs.Worktree, false
		}
		name := statusName(code)
		if name == "" {
			continue
		}
		out.Files = append(out.Files, FileStatus{Path: rel, Status: name, Staged: staged})
	}
	return out, nil
}

// Diff returns the committed and on-disk versions of a file inside a local
// checkout. path is relative to the source directory.
func (s *Service) WorkingTreeDiff(dir, path string) (WorkingTreeDiff, error) {
	repo, _, prefix, ok, err := openWorkingTree(dir)
	if err != nil {
		return WorkingTreeDiff{}, err
	}
	if !ok {
		return WorkingTreeDiff{}, nil
	}

	repoPath := filepath.ToSlash(filepath.Join(prefix, filepath.FromSlash(path)))

	var old string
	if head, err := repo.Head(); err == nil {
		commit, err := repo.CommitObject(head.Hash())
		if err != nil {
			return WorkingTreeDiff{}, err
		}
		f, err := commit.File(repoPath)
		switch {
		case err == nil:
			old, err = f.Contents()
			if err != nil {
				return WorkingTreeDiff{}, err
			}
		case errors.Is(err, object.ErrFileNotFound):
			// Newly added file — nothing committed to compare against yet.
		default:
			return WorkingTreeDiff{}, err
		}
	}

	// A deleted file leaves the on-disk side empty rather than erroring.
	var current string
	if b, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(path))); err == nil {
		current = string(b)
	} else if !errors.Is(err, os.ErrNotExist) {
		return WorkingTreeDiff{}, err
	}

	return WorkingTreeDiff{Available: true, Old: old, New: current}, nil
}

func relativeTo(prefix, path string) (string, bool) {
	if prefix == "" {
		return path, true
	}
	if !strings.HasPrefix(path, prefix+"/") {
		return "", false
	}
	return strings.TrimPrefix(path, prefix+"/"), true
}
