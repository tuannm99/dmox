package staticbuild

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/config"
)

// buildFixture writes files into a temp local source, builds a single-workspace
// config (workspace "example", source "local"), syncs+indexes, runs the real
// Build, and returns the export's out dir.
func buildFixture(t *testing.T, files map[string]string) string {
	t.Helper()
	docsDir := t.TempDir()
	for name, content := range files {
		mustWrite(t, filepath.Join(docsDir, name), content)
	}
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "example", Name: "Example", Sources: []config.Source{{ID: "local", Type: "local", Path: docsDir}}},
		},
	}
	a, err := app.New(cfg)
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	t.Cleanup(func() { a.Close() })

	ctx := context.Background()
	if err := a.SyncAndIndexAll(ctx, true); err != nil {
		t.Fatalf("SyncAndIndexAll: %v", err)
	}

	out := t.TempDir()
	if err := Build(ctx, a, Options{WorkspaceID: "example", OutDir: out}); err != nil {
		t.Fatalf("Build: %v", err)
	}
	return out
}

func TestBuild_CodeFileEmittedNotIndexed(t *testing.T) {
	out := buildFixture(t, map[string]string{
		"guide.md": "# Guide\nhello",
		"main.go":  "package main",
	})

	var fv struct{ Kind, Language string }
	readJSON(t, filepath.Join(out, "data", "files", "local", "main.go.json"), &fv)
	if fv.Kind != "code" || fv.Language != "go" {
		t.Fatalf("main.go.json = %+v, want code/go", fv)
	}

	var idx []map[string]any
	readJSON(t, filepath.Join(out, "data", "search-index.json"), &idx)
	for _, r := range idx {
		if r["path"] == "main.go" {
			t.Fatal("code file must not be in the search index")
		}
	}
}

func readJSON(t *testing.T, p string, v any) {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}
