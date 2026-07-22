package gitsvc

import (
	"fmt"
	"strings"
	"sync"
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

type Service struct {
	mu sync.Mutex
	wt map[string]*wtEntry // working-tree status cache, see worktree.go
}

func New() *Service { return &Service{wt: make(map[string]*wtEntry)} }

func (s *Service) History(mirrorDir, path string, limit int) ([]Commit, error) {
	repo, err := git.PlainOpen(mirrorDir)
	if err != nil {
		return nil, fmt.Errorf("open repo: %w", err)
	}
	head, err := repo.Head()
	if err != nil {
		return nil, fmt.Errorf("resolve head: %w", err)
	}
	iter, err := repo.Log(&git.LogOptions{From: head.Hash(), FileName: &path, Order: git.LogOrderCommitterTime})
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
