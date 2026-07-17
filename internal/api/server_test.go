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
	"github.com/tuannm99/dmox/internal/doctree"
)

func newTestApp(t *testing.T) *app.App {
	t.Helper()
	docsDir := t.TempDir()
	mustWrite(t, filepath.Join(docsDir, "guide.md"), "---\ntitle: My Guide\n---\n# My Guide\nhello world getting started")
	mustWrite(t, filepath.Join(docsDir, "CLAUDE.md"), "agent instructions")
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

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestAPI_ListWorkspaces(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out []map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	if len(out) != 1 || out[0]["id"] != "ws" {
		t.Fatalf("workspaces = %+v", out)
	}
}

func TestAPI_Tree(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/tree")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var tree doctree.TreeNode
	json.NewDecoder(resp.Body).Decode(&tree)
	var leaves []string
	doctree.CollectLeaves(tree, &leaves)
	if len(leaves) != 2 {
		t.Fatalf("leaves = %+v, want 2", leaves)
	}
}

func TestAPI_Tree_UnknownWorkspace(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()
	resp, _ := http.Get(srv.URL + "/api/workspaces/nope/tree")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestAPI_File(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/file?path=local/guide.md")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var fv map[string]any
	json.NewDecoder(resp.Body).Decode(&fv)
	if fv["title"] != "My Guide" {
		t.Fatalf("title = %v", fv["title"])
	}
	if fv["is_ai_context"] != false {
		t.Fatalf("is_ai_context = %v, want false", fv["is_ai_context"])
	}
}

func TestAPI_File_AIContextFlag(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, _ := http.Get(srv.URL + "/api/workspaces/ws/file?path=local/CLAUDE.md")
	defer resp.Body.Close()
	var fv map[string]any
	json.NewDecoder(resp.Body).Decode(&fv)
	if fv["is_ai_context"] != true {
		t.Fatalf("is_ai_context = %v, want true", fv["is_ai_context"])
	}
}

func TestAPI_CORSHeaders(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()
	resp, _ := http.Get(srv.URL + "/api/workspaces")
	if resp.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("missing CORS header")
	}
}
