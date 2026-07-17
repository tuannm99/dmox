package search

import (
	"context"
	"encoding/binary"
	"math"
	"sort"

	"github.com/tuannm99/dmox/internal/store"
)

type VectorStore struct {
	store *store.Store
}

func NewVectorStore(s *store.Store) *VectorStore { return &VectorStore{store: s} }

func (vs *VectorStore) EnsureSchema(ctx context.Context) error {
	_, err := vs.store.DB().ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS embeddings (
			workspace_id TEXT NOT NULL, source_id TEXT NOT NULL, path TEXT NOT NULL,
			vector BLOB NOT NULL, PRIMARY KEY (workspace_id, source_id, path))`)
	return err
}

func (vs *VectorStore) Upsert(ctx context.Context, workspaceID, sourceID, path string, vec []float32) error {
	buf := make([]byte, 4*len(vec))
	for i, f := range vec {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(f))
	}
	_, err := vs.store.DB().ExecContext(ctx, `
		INSERT INTO embeddings (workspace_id, source_id, path, vector) VALUES (?, ?, ?, ?)
		ON CONFLICT(workspace_id, source_id, path) DO UPDATE SET vector=excluded.vector`,
		workspaceID, sourceID, path, buf)
	return err
}

func (vs *VectorStore) Search(ctx context.Context, workspaceID string, query []float32, limit int) ([]Result, error) {
	rows, err := vs.store.DB().QueryContext(ctx, `
		SELECT e.source_id, e.path, f.title, e.vector FROM embeddings e
		JOIN files f ON f.workspace_id=e.workspace_id AND f.source_id=e.source_id AND f.path=e.path
		WHERE e.workspace_id = ?`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type scored struct {
		Result
		sim float64
	}
	var all []scored
	for rows.Next() {
		var sourceID, path, title string
		var buf []byte
		if err := rows.Scan(&sourceID, &path, &title, &buf); err != nil {
			return nil, err
		}
		all = append(all, scored{
			Result: Result{WorkspaceID: workspaceID, SourceID: sourceID, Path: path, Title: title},
			sim:    cosine(query, bytesToVec(buf)),
		})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].sim > all[j].sim })
	if limit > 0 && len(all) > limit {
		all = all[:limit]
	}
	out := make([]Result, len(all))
	for i, s := range all {
		s.Result.Score = s.sim
		out[i] = s.Result
	}
	return out, nil
}

func cosine(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return -1
	}
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return -1
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}

func bytesToVec(buf []byte) []float32 {
	vec := make([]float32, len(buf)/4)
	for i := range vec {
		vec[i] = math.Float32frombits(binary.LittleEndian.Uint32(buf[i*4:]))
	}
	return vec
}
