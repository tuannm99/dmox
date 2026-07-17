package search

import (
	"context"
	"fmt"
	"log"
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

type VectorSearcher interface {
	Search(ctx context.Context, workspaceID string, query []float32, limit int) ([]Result, error)
}

type Embedder interface {
	Embed(ctx context.Context, texts []string) ([][]float32, error)
}

type Service struct {
	store    *store.Store
	vector   VectorSearcher
	embedder Embedder
}

func New(s *store.Store) *Service { return &Service{store: s} }

func (svc *Service) SetVectorSearch(vs VectorSearcher, e Embedder) {
	svc.vector = vs
	svc.embedder = e
}

func (svc *Service) Search(ctx context.Context, workspaceID, query string, limit int) ([]Result, error) {
	ftsResults, err := svc.searchFTS(ctx, workspaceID, query, limit)
	if err != nil {
		return nil, err
	}
	if svc.vector == nil || svc.embedder == nil || strings.TrimSpace(query) == "" {
		return ftsResults, nil
	}
	return svc.mergeWithSemantic(ctx, workspaceID, query, limit, ftsResults), nil
}

func (svc *Service) mergeWithSemantic(ctx context.Context, workspaceID, query string, limit int, ftsResults []Result) []Result {
	vecs, err := svc.embedder.Embed(ctx, []string{query})
	if err != nil || len(vecs) == 0 {
		log.Printf("semantic search skipped: %v", err)
		return ftsResults
	}
	semResults, err := svc.vector.Search(ctx, workspaceID, vecs[0], limit)
	if err != nil {
		log.Printf("semantic search skipped: %v", err)
		return ftsResults
	}
	return mergeResults(ftsResults, semResults, limit)
}

func mergeResults(fts, sem []Result, limit int) []Result {
	seen := map[string]bool{}
	var out []Result
	for _, r := range fts {
		key := r.SourceID + "/" + r.Path
		if !seen[key] {
			seen[key] = true
			out = append(out, r)
		}
	}
	for _, r := range sem {
		key := r.SourceID + "/" + r.Path
		if !seen[key] {
			seen[key] = true
			out = append(out, r)
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
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
