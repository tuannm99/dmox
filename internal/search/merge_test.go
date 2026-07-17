package search

import (
	"context"
	"errors"
	"testing"
)

type fakeEmbedder struct {
	vec []float32
	err error
}

func (f fakeEmbedder) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if f.err != nil {
		return nil, f.err
	}
	return [][]float32{f.vec}, nil
}
func (f fakeEmbedder) Dimensions() int { return len(f.vec) }

type fakeVectorSearcher struct {
	results []Result
	err     error
}

func (f fakeVectorSearcher) Search(ctx context.Context, workspaceID string, query []float32, limit int) ([]Result, error) {
	return f.results, f.err
}

func TestService_Search_DegradesToFTSWhenEmbeddingFails(t *testing.T) {
	st := newTestStore(t)
	seedFile(t, st, "ws", "src", "guide.md", "Guide", "getting started guide")
	svc := New(st)
	svc.SetVectorSearch(fakeVectorSearcher{}, fakeEmbedder{err: errors.New("timeout")})

	results, err := svc.Search(context.Background(), "ws", "getting started", 10)
	if err != nil {
		t.Fatalf("Search should not fail when embeddings error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("results = %+v, want FTS fallback result", results)
	}
}

func TestService_Search_MergesFTSAndSemanticWithoutDuplicates(t *testing.T) {
	st := newTestStore(t)
	seedFile(t, st, "ws", "src", "guide.md", "Guide", "getting started guide")
	seedFile(t, st, "ws", "src", "semantic-only.md", "Semantic", "unrelated words entirely")
	svc := New(st)
	svc.SetVectorSearch(fakeVectorSearcher{results: []Result{
		{WorkspaceID: "ws", SourceID: "src", Path: "guide.md", Title: "Guide"},
		{WorkspaceID: "ws", SourceID: "src", Path: "semantic-only.md", Title: "Semantic"},
	}}, fakeEmbedder{vec: []float32{1, 0}})

	results, err := svc.Search(context.Background(), "ws", "getting started", 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("results = %+v, want 2 deduplicated results", results)
	}
}
