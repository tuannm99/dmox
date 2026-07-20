package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/config"
)

func TestApp_New_WiresWorkspacesAndSources(t *testing.T) {
	docsDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(docsDir, "guide.md"), []byte("# Guide"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Server:     config.ServerConfig{Addr: ":0"},
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{
				{ID: "local", Type: "local", Path: docsDir},
			}},
		},
	}
	a, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer a.Close()

	ws, ok := a.Workspace("ws")
	if !ok {
		t.Fatal("workspace ws not found")
	}
	if len(ws.Sources) != 1 {
		t.Fatalf("sources = %+v", ws.Sources)
	}
	if got := ws.SourceIDs(); len(got) != 1 || got[0] != "local" {
		t.Fatalf("SourceIDs = %+v", got)
	}
}

func TestApp_SyncAndIndexAll_IndexesFiles(t *testing.T) {
	docsDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(docsDir, "guide.md"), []byte("# Guide\nhello"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Server:     config.ServerConfig{Addr: ":0"},
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{
				{ID: "local", Type: "local", Path: docsDir},
			}},
		},
	}
	a, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer a.Close()

	if err := a.SyncAndIndexAll(context.Background(), true); err != nil {
		t.Fatalf("SyncAndIndexAll: %v", err)
	}
	var count int
	if err := a.Store.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE workspace_id='ws'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("indexed row count = %d, want 1", count)
	}
}

func TestApp_New_RejectsUnknownSourceType(t *testing.T) {
	cfg := &config.Config{
		DataDir: t.TempDir(),
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{
				{ID: "s", Type: "ftp", Path: "/x"},
			}},
		},
	}
	if _, err := New(cfg); err == nil {
		t.Fatal("expected error for unknown source type")
	}
}

func TestApp_SyncAndIndexAll_FailFastAbortsOnFirstError(t *testing.T) {
	nonexistentPath := "/nonexistent/path/that/does/not/exist"
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Server:     config.ServerConfig{Addr: ":0"},
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{
				{ID: "local", Type: "local", Path: nonexistentPath},
			}},
		},
	}
	a, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer a.Close()

	err = a.SyncAndIndexAll(context.Background(), true)
	if err == nil {
		t.Fatal("expected error for nonexistent source path with failFast=true")
	}
}

func TestApp_SyncAndIndexAll_DegradesGracefullyWhenNotFailFast(t *testing.T) {
	// Create one valid directory with a markdown file
	validDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(validDir, "file.md"), []byte("# Content\nhello world"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Use a nonexistent path for the second source
	nonexistentPath := "/nonexistent/path/that/does/not/exist"

	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Server:     config.ServerConfig{Addr: ":0"},
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{
				{ID: "broken", Type: "local", Path: nonexistentPath},
				{ID: "healthy", Type: "local", Path: validDir},
			}},
		},
	}
	a, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer a.Close()

	// Call with failFast=false; should not return an error
	err = a.SyncAndIndexAll(context.Background(), false)
	if err != nil {
		t.Fatalf("SyncAndIndexAll with failFast=false returned error: %v", err)
	}

	// Verify the healthy source's file was indexed
	var count int
	if err := a.Store.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE workspace_id='ws' AND source_id='healthy'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("indexed row count for healthy source = %d, want 1", count)
	}
}

func TestApp_New_WiresLivesyncHubAndDiffCache(t *testing.T) {
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Server:     config.ServerConfig{Addr: ":0"},
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
	}
	a, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer a.Close()

	if a.Events == nil {
		t.Fatal("expected App.Events to be initialized")
	}
	if a.Diffs == nil {
		t.Fatal("expected App.Diffs to be initialized")
	}

	// Roundtrip: Diffs should behave like a working DiffCache.
	a.Diffs.Record("ws", "local", "x.md", "old", "new")
	old, new_, available := a.Diffs.Consume("ws", "local", "x.md")
	if !available || old != "old" || new_ != "new" {
		t.Fatalf("Diffs roundtrip = (%q, %q, %v)", old, new_, available)
	}
}
