package doctree

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/source"
)

func TestBuild_MergesMultipleSourcesIntoOneTree(t *testing.T) {
	dirA := t.TempDir()
	dirB := t.TempDir()
	mustWrite(t, filepath.Join(dirA, "guide.md"), "a")
	mustWrite(t, filepath.Join(dirB, "sub", "other.md"), "b")

	sources := map[string]source.Source{
		"a": source.NewLocalSource("a", dirA),
		"b": source.NewLocalSource("b", dirB),
	}
	tree, err := Build(context.Background(), "Workspace", []string{"a", "b"}, sources)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if len(tree.Children) != 2 {
		t.Fatalf("root children = %+v, want 2 mount points", tree.Children)
	}
	var leaves []string
	CollectLeaves(tree, &leaves)
	if len(leaves) != 2 {
		t.Fatalf("leaves = %+v, want 2", leaves)
	}
	found := map[string]bool{}
	for _, l := range leaves {
		found[l] = true
	}
	if !found["a/guide.md"] || !found["b/sub/other.md"] {
		t.Fatalf("leaves = %+v", leaves)
	}
}

func TestSplitSourcePath(t *testing.T) {
	sourceID, relPath, err := SplitSourcePath("local/guide.md")
	if err != nil || sourceID != "local" || relPath != "guide.md" {
		t.Fatalf("got %q %q %v", sourceID, relPath, err)
	}
	if _, _, err := SplitSourcePath("no-slash"); err == nil {
		t.Fatal("expected error for path missing source prefix")
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := writeFile(path, content); err != nil {
		t.Fatal(err)
	}
}
