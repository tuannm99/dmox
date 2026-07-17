package index

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"time"

	"github.com/tuannm99/dmox/internal/source"
	"github.com/tuannm99/dmox/internal/store"
)

type Indexer struct {
	store *store.Store
}

func New(s *store.Store) *Indexer { return &Indexer{store: s} }

func (ix *Indexer) IndexSource(ctx context.Context, workspaceID string, src source.Source) error {
	files, err := src.List(ctx)
	if err != nil {
		return fmt.Errorf("list source %s: %w", src.ID(), err)
	}
	seen := make(map[string]bool, len(files))
	for _, f := range files {
		seen[f.Path] = true
		raw, err := src.Read(ctx, f.Path)
		if err != nil {
			log.Printf("index: skip %s/%s: read error: %v", src.ID(), f.Path, err)
			continue
		}
		if err := ix.upsert(ctx, workspaceID, src.ID(), f.Path, raw, f.ModTime.Unix()); err != nil {
			return fmt.Errorf("index %s/%s: %w", src.ID(), f.Path, err)
		}
	}
	return ix.removeStale(ctx, workspaceID, src.ID(), seen)
}

func (ix *Indexer) IndexFile(ctx context.Context, workspaceID string, src source.Source, path string) error {
	raw, err := src.Read(ctx, path)
	if err != nil {
		_, delErr := ix.store.DB().ExecContext(ctx,
			`DELETE FROM files WHERE workspace_id=? AND source_id=? AND path=?`,
			workspaceID, src.ID(), path)
		return delErr
	}
	return ix.upsert(ctx, workspaceID, src.ID(), path, raw, time.Now().Unix())
}

func (ix *Indexer) upsert(ctx context.Context, workspaceID, sourceID, path string, raw []byte, mtime int64) error {
	doc := Parse(raw, filepath.Base(path))
	fmJSON, err := json.Marshal(doc.Frontmatter)
	if err != nil {
		return err
	}
	_, err = ix.store.DB().ExecContext(ctx, `
		INSERT INTO files (workspace_id, source_id, path, title, frontmatter, body, is_ai_context, mtime)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(workspace_id, source_id, path) DO UPDATE SET
			title=excluded.title, frontmatter=excluded.frontmatter, body=excluded.body,
			is_ai_context=excluded.is_ai_context, mtime=excluded.mtime`,
		workspaceID, sourceID, path, doc.Title, string(fmJSON), doc.Body,
		boolToInt(IsAIContextFile(path)), mtime)
	return err
}

func (ix *Indexer) removeStale(ctx context.Context, workspaceID, sourceID string, seen map[string]bool) error {
	rows, err := ix.store.DB().QueryContext(ctx,
		`SELECT path FROM files WHERE workspace_id=? AND source_id=?`, workspaceID, sourceID)
	if err != nil {
		return err
	}
	var stale []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			rows.Close()
			return err
		}
		if !seen[p] {
			stale = append(stale, p)
		}
	}
	rows.Close()
	for _, p := range stale {
		if _, err := ix.store.DB().ExecContext(ctx,
			`DELETE FROM files WHERE workspace_id=? AND source_id=? AND path=?`, workspaceID, sourceID, p); err != nil {
			return err
		}
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
