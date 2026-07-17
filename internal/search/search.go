package search

import (
	"context"
	"fmt"
	"strings"

	"github.com/tuannm99/dmox/internal/store"
)

type Result struct {
	WorkspaceID string  `json:"workspace_id"`
	SourceID    string  `json:"source_id"`
	Path        string  `json:"path"`
	Title       string  `json:"title"`
	Snippet     string  `json:"snippet"`
	Score       float64 `json:"score"`
}

type Service struct {
	store *store.Store
	// Task 9: vector and embedder fields will be added here
}

func New(s *store.Store) *Service { return &Service{store: s} }

func (svc *Service) Search(ctx context.Context, workspaceID, query string, limit int) ([]Result, error) {
	ftsResults, err := svc.searchFTS(ctx, workspaceID, query, limit)
	if err != nil {
		return nil, err
	}
	// Task 9: mergeWithSemantic logic will be added here
	return ftsResults, nil
}

func (svc *Service) searchFTS(ctx context.Context, workspaceID, query string, limit int) ([]Result, error) {
	if strings.TrimSpace(query) == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 20
	}
	rows, err := svc.store.DB().QueryContext(ctx, `
		SELECT f.source_id, f.path, f.title,
		       snippet(files_fts, 2, '<mark>', '</mark>', '…', 12) AS snip,
		       bm25(files_fts) AS rank
		FROM files_fts
		JOIN files f ON f.rowid = files_fts.rowid
		WHERE files_fts MATCH ? AND f.workspace_id = ?
		ORDER BY rank
		LIMIT ?`, toFTS5Query(query), workspaceID, limit)
	if err != nil {
		return nil, fmt.Errorf("fts query: %w", err)
	}
	defer rows.Close()
	var results []Result
	for rows.Next() {
		var r Result
		r.WorkspaceID = workspaceID
		if err := rows.Scan(&r.SourceID, &r.Path, &r.Title, &r.Snippet, &r.Score); err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

func toFTS5Query(q string) string {
	fields := strings.Fields(q)
	for i, f := range fields {
		f = strings.ReplaceAll(f, `"`, `""`)
		fields[i] = `"` + f + `"*`
	}
	return strings.Join(fields, " ")
}
