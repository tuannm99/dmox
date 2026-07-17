package search

import (
	"context"
	"testing"
)

func TestVectorStore_UpsertAndSearchRanksByCosine(t *testing.T) {
	st := newTestStore(t)
	seedFile(t, st, "ws", "src", "a.md", "A", "content a")
	seedFile(t, st, "ws", "src", "b.md", "B", "content b")
	vs := NewVectorStore(st)
	ctx := context.Background()
	if err := vs.EnsureSchema(ctx); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}
	if err := vs.Upsert(ctx, "ws", "src", "a.md", []float32{1, 0, 0}); err != nil {
		t.Fatalf("Upsert a: %v", err)
	}
	if err := vs.Upsert(ctx, "ws", "src", "b.md", []float32{0, 1, 0}); err != nil {
		t.Fatalf("Upsert b: %v", err)
	}

	results, err := vs.Search(ctx, "ws", []float32{1, 0, 0}, 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 2 || results[0].Path != "a.md" {
		t.Fatalf("results = %+v, want a.md ranked first (identical vector)", results)
	}
}
