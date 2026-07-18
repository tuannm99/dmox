package index

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/source"
	"github.com/tuannm99/dmox/internal/store"
)

func newTestStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "dmox.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestParse_FrontmatterAndFallbackTitle(t *testing.T) {
	doc := Parse([]byte("---\ntitle: Custom Title\n---\n# Heading\nbody text"), "fallback.md")
	if doc.Title != "Custom Title" {
		t.Fatalf("Title = %q", doc.Title)
	}
	if doc.Frontmatter["title"] != "Custom Title" {
		t.Fatalf("Frontmatter = %+v", doc.Frontmatter)
	}

	doc2 := Parse([]byte("# Heading Only\nbody"), "fallback.md")
	if doc2.Title != "Heading Only" {
		t.Fatalf("Title (heading fallback) = %q", doc2.Title)
	}

	doc3 := Parse([]byte("no heading, no frontmatter"), "fallback.md")
	if doc3.Title != "fallback.md" {
		t.Fatalf("Title (filename fallback) = %q", doc3.Title)
	}
}

func TestParse_MalformedFrontmatterLogsWarningAndFallsBackToRawContent(t *testing.T) {
	// Test with malformed YAML frontmatter (unterminated list)
	malformedYAML := "---\ntitle: [unterminated\n---\n# Heading\nThis is the body"
	doc := Parse([]byte(malformedYAML), "fallback.md")

	// Verify that parsing continues despite YAML error (best-effort behavior)
	// When frontmatter fails to parse, title should fall back to heading
	if doc.Title != "Heading" {
		t.Fatalf("Title = %q, want 'Heading' (should use heading fallback after malformed YAML)", doc.Title)
	}

	// Verify the body is still indexed and usable (raw content after frontmatter block removed)
	if doc.Body != "This is the body" {
		t.Fatalf("Body = %q, want 'This is the body'", doc.Body)
	}

	// Verify the frontmatter map is empty because YAML parsing failed
	if len(doc.Frontmatter) != 0 {
		t.Fatalf("Frontmatter = %+v, want empty map", doc.Frontmatter)
	}
}

func TestIsAIContextFile(t *testing.T) {
	cases := map[string]bool{
		"CLAUDE.md":             true,
		"AGENTS.md":             true,
		".cursorrules":          true,
		".cursor/rules/foo.mdc": true,
		"guide.md":              false,
		"nested/CLAUDE.md":      true,
	}
	for path, want := range cases {
		if got := IsAIContextFile(path); got != want {
			t.Errorf("IsAIContextFile(%q) = %v, want %v", path, got, want)
		}
	}
}

func TestIndexer_IndexSourceUpsertsAndRemovesStale(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "guide.md"), "# Guide\nhello world")
	mustWrite(t, filepath.Join(dir, "CLAUDE.md"), "agent instructions")
	src := source.NewLocalSource("local", dir)
	ctx := context.Background()

	st := newTestStore(t)
	ix := New(st)
	if err := ix.IndexSource(ctx, "ws", src); err != nil {
		t.Fatalf("IndexSource: %v", err)
	}

	var count int
	if err := st.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE workspace_id='ws' AND source_id='local'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("indexed row count = %d, want 2", count)
	}
	var isAI int
	if err := st.DB().QueryRow(`SELECT is_ai_context FROM files WHERE path='CLAUDE.md'`).Scan(&isAI); err != nil {
		t.Fatal(err)
	}
	if isAI != 1 {
		t.Fatal("CLAUDE.md should be flagged as AI context")
	}

	if err := os.Remove(filepath.Join(dir, "CLAUDE.md")); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexSource(ctx, "ws", src); err != nil {
		t.Fatalf("re-IndexSource: %v", err)
	}
	if err := st.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE workspace_id='ws' AND source_id='local'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("row count after deletion = %d, want 1 (stale row removed)", count)
	}
}

func TestIndexer_IndexFile_UpsertAndDelete(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "guide.md"), "# Guide\noriginal")
	src := source.NewLocalSource("local", dir)
	ctx := context.Background()
	st := newTestStore(t)
	ix := New(st)

	if err := ix.IndexFile(ctx, "ws", src, "guide.md"); err != nil {
		t.Fatalf("IndexFile: %v", err)
	}
	var body string
	if err := st.DB().QueryRow(`SELECT body FROM files WHERE path='guide.md'`).Scan(&body); err != nil {
		t.Fatal(err)
	}
	if body != "original" {
		t.Fatalf("body = %q", body)
	}

	if err := os.Remove(filepath.Join(dir, "guide.md")); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexFile(ctx, "ws", src, "guide.md"); err != nil {
		t.Fatalf("IndexFile (delete path): %v", err)
	}
	var count int
	if err := st.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE path='guide.md'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("expected row removed after file deleted on disk")
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
