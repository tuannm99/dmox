package source

import (
	"context"
	"time"
)

type FileInfo struct {
	Path    string
	ModTime time.Time
	Size    int64
}

type ChangeOp int

const (
	ChangeOpModify ChangeOp = iota
	ChangeOpCreate
	ChangeOpDelete
)

type ChangeEvent struct {
	Path string
	Op   ChangeOp
}

// Source is the common interface every content origin (local folder, git
// mirror, ...) implements. DMOX never writes back to a Source.
type Source interface {
	ID() string
	Sync(ctx context.Context) error
	List(ctx context.Context) ([]FileInfo, error)
	Read(ctx context.Context, path string) ([]byte, error)
	// Watch returns a channel of change events, or (nil, nil) if this source
	// doesn't support live watching (e.g. GitSource, which is updated via Sync).
	Watch(ctx context.Context) (<-chan ChangeEvent, error)
	SupportsGit() bool
}

// IsDocFile reports whether a filename is one DMOX indexes. Exported because
// the API layer needs the same rule when filtering git status down to files
// that actually exist in the doc tree.
func IsDocFile(name string) bool {
	ext := extLower(name)
	return ext == ".md" || ext == ".markdown"
}
