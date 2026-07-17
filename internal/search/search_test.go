package search

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/store"
)

func seedFile(t *testing.T, st *store.Store, workspaceID, sourceID, path, title, body string) {
	t.Helper()
	_, err := st.DB().Exec(`INSERT INTO files (workspace_id, source_id, path, title, frontmatter, body, is_ai_context, mtime)
		VALUES (?, ?, ?, ?, '{}', ?, 0, 0)`, workspaceID, sourceID, path, title, body)
	if err != nil {
		t.Fatal(err)
	}
}

func newTestStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "dmox.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestSearch_ReturnsMatchesWithSnippet(t *testing.T) {
	st := newTestStore(t)
	seedFile(t, st, "ws", "src", "guide.md", "Getting Started", "This guide covers getting started with dmox.")
	seedFile(t, st, "ws", "src", "other.md", "Other Topic", "Nothing relevant here.")
	seedFile(t, st, "other-ws", "src", "guide.md", "Getting Started", "getting started elsewhere")

	svc := New(st)
	results, err := svc.Search(context.Background(), "ws", "getting started", 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("results = %+v, want 1 match scoped to workspace ws", results)
	}
	if results[0].Path != "guide.md" {
		t.Fatalf("Path = %q", results[0].Path)
	}
	if !containsMark(results[0].Snippet) {
		t.Fatalf("Snippet = %q, want <mark> highlighting", results[0].Snippet)
	}
}

func TestSearch_EmptyQueryReturnsNoResults(t *testing.T) {
	st := newTestStore(t)
	svc := New(st)
	results, err := svc.Search(context.Background(), "ws", "  ", 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("results = %+v, want empty", results)
	}
}

func containsMark(s string) bool {
	for i := 0; i+6 <= len(s); i++ {
		if s[i:i+6] == "<mark>" {
			return true
		}
	}
	return false
}
