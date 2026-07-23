package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/config"
)

func newCodeApp(t *testing.T) *app.App {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "guide.md"), []byte("# Guide\nhi"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte("package main"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app.log"), []byte("2026-07-23 boot ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Server:     config.ServerConfig{Addr: ":0"},
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{{ID: "ws", Name: "WS", Sources: []config.Source{
			{ID: "local", Type: "local", Path: dir},
		}}},
	}
	a, err := app.New(cfg)
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	t.Cleanup(func() { a.Close() })
	if err := a.SyncAndIndexAll(context.Background(), true); err != nil {
		t.Fatalf("SyncAndIndexAll: %v", err)
	}
	return a
}

func TestAPI_File_CodeKind(t *testing.T) {
	a := newCodeApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/file?path=local/main.go")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var fv struct {
		Kind, Language, Body string
	}
	json.NewDecoder(resp.Body).Decode(&fv)
	if fv.Kind != "code" || fv.Language != "go" || fv.Body != "package main" {
		t.Fatalf("got %+v, want code/go/package main", fv)
	}
}

func TestAPI_File_UnsupportedKind_404(t *testing.T) {
	a := newCodeApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/file?path=local/app.log")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

func TestAPI_File_MarkdownKind(t *testing.T) {
	a := newCodeApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/file?path=local/guide.md")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var fv struct{ Kind string }
	json.NewDecoder(resp.Body).Decode(&fv)
	if fv.Kind != "markdown" {
		t.Fatalf("Kind = %q, want markdown", fv.Kind)
	}
}
