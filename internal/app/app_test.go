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
		DataDir: t.TempDir(),
		Server:  config.ServerConfig{Addr: ":0"},
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
		DataDir: t.TempDir(),
		Server:  config.ServerConfig{Addr: ":0"},
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
