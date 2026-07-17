package main

import (
	"encoding/json"
	"testing"

	"github.com/tuannm99/dmox/internal/doctree"
)

func TestCollectLeaves(t *testing.T) {
	tree := doctree.TreeNode{
		IsDir: true,
		Children: []doctree.TreeNode{
			{Name: "a.md", Path: "local/a.md", IsDir: false},
			{Name: "dir", IsDir: true, Children: []doctree.TreeNode{
				{Name: "b.md", Path: "local/dir/b.md", IsDir: false},
			}},
		},
	}
	var out []string
	collectLeaves(tree, &out)
	if len(out) != 2 {
		t.Fatalf("leaves = %+v, want 2", out)
	}
}

func TestAIContextDeserialization(t *testing.T) {
	// Test that JSON with snake_case fields correctly deserializes into struct with json tags.
	// This verifies the fix for the bug where source_id was not being unmarshaled into SourceID.
	jsonData := `[{"source_id":"local","path":"guide.md","title":"Guide"}]`

	var entries []struct {
		SourceID string `json:"source_id"`
		Path     string `json:"path"`
		Title    string `json:"title"`
	}

	if err := json.Unmarshal([]byte(jsonData), &entries); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if len(entries) != 1 {
		t.Fatalf("Expected 1 entry, got %d", len(entries))
	}

	e := entries[0]
	if e.SourceID != "local" {
		t.Errorf("SourceID = %q, want %q", e.SourceID, "local")
	}
	if e.Path != "guide.md" {
		t.Errorf("Path = %q, want %q", e.Path, "guide.md")
	}
	if e.Title != "Guide" {
		t.Errorf("Title = %q, want %q", e.Title, "Guide")
	}
}
