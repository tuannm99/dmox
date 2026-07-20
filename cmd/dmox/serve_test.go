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

func TestWatchAndReindex_PublishesEventAndRecordsDiff(t *testing.T) {
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
	ctx := context.Background()
	if err := a.Indexer.IndexFile(ctx, "ws", src, "guide.md"); err != nil {
		t.Fatalf("seed IndexFile: %v", err)
	}

	sub, cancel := a.Events.Subscribe("ws")
	defer cancel()

	if err := os.WriteFile(filepath.Join(docsDir, "guide.md"), []byte("# Guide\nv2"), 0o644); err != nil {
		t.Fatal(err)
	}
	events := make(chan source.ChangeEvent, 1)
	events <- source.ChangeEvent{Path: "guide.md", Op: source.ChangeOpModify}
	close(events)

	watchAndReindex(ctx, a, "ws", src, events)

	select {
	case ev := <-sub:
		if ev.SourceID != "local" || ev.Path != "guide.md" || ev.Op != "modify" {
			t.Fatalf("published event = %+v", ev)
		}
	default:
		t.Fatal("expected an event to have been published")
	}

	old, new_, available := a.Diffs.Consume("ws", "local", "guide.md")
	if !available {
		t.Fatal("expected a diff entry to have been recorded")
	}
	if old != "v1" || new_ != "v2" {
		t.Fatalf("diff = (old=%q, new=%q)", old, new_)
	}
}

func TestWatchAndReindex_DeleteDoesNotRecordDiff(t *testing.T) {
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
	ctx := context.Background()
	if err := a.Indexer.IndexFile(ctx, "ws", src, "guide.md"); err != nil {
		t.Fatalf("seed IndexFile: %v", err)
	}
	if err := os.Remove(filepath.Join(docsDir, "guide.md")); err != nil {
		t.Fatal(err)
	}

	events := make(chan source.ChangeEvent, 1)
	events <- source.ChangeEvent{Path: "guide.md", Op: source.ChangeOpDelete}
	close(events)

	watchAndReindex(ctx, a, "ws", src, events)

	if _, _, available := a.Diffs.Consume("ws", "local", "guide.md"); available {
		t.Fatal("expected no diff entry for a delete")
	}
}
