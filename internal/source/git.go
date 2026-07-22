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

func (s *GitSource) ID() string        { return s.id }
func (s *GitSource) SupportsGit() bool { return true }
func (s *GitSource) MirrorDir() string { return s.mirrorDir }

func (s *GitSource) Sync(ctx context.Context) error {
	if _, err := os.Stat(filepath.Join(s.mirrorDir, ".git")); errors.Is(err, os.ErrNotExist) {
		return s.clone(ctx)
	}
	return s.fetchAndReset(ctx)
}

func (s *GitSource) clone(ctx context.Context) error {
	// Remove any pre-existing content at mirrorDir (from a failed prior clone attempt)
	// to ensure clone() always starts from a guaranteed-empty target.
	if err := os.RemoveAll(s.mirrorDir); err != nil {
		return fmt.Errorf("git source %s: remove pre-existing mirror: %w", s.id, err)
	}
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
		if !IsDocFile(d.Name()) {
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
