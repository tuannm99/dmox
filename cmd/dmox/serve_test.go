package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/config"
	"github.com/tuannm99/dmox/internal/source"
)

func TestWatchAndReindex_ProcessesEventsThenExitsOnChannelClose(t *testing.T) {
	docsDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(docsDir, "guide.md"), []byte("# Guide\nv1"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{{ID: "local", Type: "local", Path: docsDir}}},
		},
	}
	a, err := app.New(cfg)
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	defer a.Close()

	src := a.Workspaces["ws"].Sources["local"]
	events := make(chan source.ChangeEvent, 1)
	events <- source.ChangeEvent{Path: "guide.md", Op: source.ChangeOpModify}
	close(events)

	watchAndReindex(context.Background(), a, "ws", src, events)

	var count int
	if err := a.Store.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE path='guide.md'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected guide.md indexed after watch event, count=%d", count)
	}
}
