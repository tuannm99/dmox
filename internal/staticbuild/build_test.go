package staticbuild

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/api"
	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/config"
	"github.com/tuannm99/dmox/internal/doctree"
	"github.com/tuannm99/dmox/internal/render"
)

func newFixtureApp(t *testing.T) (*app.App, string) {
	t.Helper()
	docsDir := t.TempDir()
	mustWrite(t, filepath.Join(docsDir, "guide.md"), "---\ntitle: Guide\n---\n# Guide\nhello world")
	mustWrite(t, filepath.Join(docsDir, "CLAUDE.md"), "agent instructions")
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
	t.Cleanup(func() { a.Close() })
	return a, docsDir
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

func TestBuild_ProducesExpectedDataFiles(t *testing.T) {
	a, _ := newFixtureApp(t)
	out := t.TempDir()
	ctx := context.Background()
	if err := Build(ctx, a, Options{WorkspaceID: "ws", OutDir: out, BasePath: "/repo/"}); err != nil {
		t.Fatalf("Build: %v", err)
	}

	requireFile := func(rel string) []byte {
		b, err := os.ReadFile(filepath.Join(out, rel))
		if err != nil {
			t.Fatalf("expected %s to exist: %v", rel, err)
		}
		return b
	}

	var tree doctree.TreeNode
	json.Unmarshal(requireFile("data/tree.json"), &tree)
	var leaves []string
	doctree.CollectLeaves(tree, &leaves)
	if len(leaves) != 2 {
		t.Fatalf("leaves = %+v, want 2", leaves)
	}

	var fv render.FileView
	json.Unmarshal(requireFile("data/files/local/guide.md.json"), &fv)
	if fv.Title != "Guide" {
		t.Fatalf("Title = %q", fv.Title)
	}

	var aiContext []map[string]string
	json.Unmarshal(requireFile("data/ai-context.json"), &aiContext)
	if len(aiContext) != 1 || aiContext[0]["path"] != "CLAUDE.md" {
		t.Fatalf("ai-context = %+v", aiContext)
	}

	var searchIndex []map[string]any
	json.Unmarshal(requireFile("data/search-index.json"), &searchIndex)
	if len(searchIndex) != 2 {
		t.Fatalf("search index = %+v, want 2 entries", searchIndex)
	}

	requireFile("index.html")
	shell := requireFile("w/ws/doc/local/guide.md/index.html")
	if !contains(string(shell), "/repo/") {
		t.Fatalf("route shell should have base-path token replaced with /repo/, got: %s", shell)
	}
	if contains(string(shell), "__DMOX_BASE__") {
		t.Fatalf("route shell still contains unreplaced base-path token: %s", shell)
	}
}

func TestBuild_SchemaMatchesLiveAPI(t *testing.T) {
	a, _ := newFixtureApp(t)
	ctx := context.Background()
	if err := a.SyncAndIndexAll(ctx, true); err != nil {
		t.Fatalf("SyncAndIndexAll: %v", err)
	}
	srv := httptest.NewServer(api.NewRouter(a))
	defer srv.Close()

	liveResp, err := http.Get(srv.URL + "/api/workspaces/ws/file?path=local/guide.md")
	if err != nil {
		t.Fatal(err)
	}
	defer liveResp.Body.Close()
	var liveFV render.FileView
	json.NewDecoder(liveResp.Body).Decode(&liveFV)

	out := t.TempDir()
	if err := Build(ctx, a, Options{WorkspaceID: "ws", OutDir: out, BasePath: "/"}); err != nil {
		t.Fatalf("Build: %v", err)
	}
	staticBytes, err := os.ReadFile(filepath.Join(out, "data", "files", "local", "guide.md.json"))
	if err != nil {
		t.Fatal(err)
	}
	var staticFV render.FileView
	json.Unmarshal(staticBytes, &staticFV)

	if liveFV.Title != staticFV.Title || liveFV.Path != staticFV.Path || liveFV.IsAIContext != staticFV.IsAIContext {
		t.Fatalf("static export FileView %+v does not match live API FileView %+v", staticFV, liveFV)
	}
}

func TestBuild_FailsFastOnSourceSyncError(t *testing.T) {
	cfg := &config.Config{
		DataDir:    t.TempDir(),
		Embeddings: config.EmbeddingsConfig{Provider: "none"},
		Workspaces: []config.Workspace{
			{ID: "ws", Name: "WS", Sources: []config.Source{{ID: "local", Type: "local", Path: "/nonexistent/path"}}},
		},
	}
	a, err := app.New(cfg)
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	defer a.Close()

	err = Build(context.Background(), a, Options{WorkspaceID: "ws", OutDir: t.TempDir(), BasePath: "/"})
	if err == nil {
		t.Fatal("expected Build to fail fast on a source sync error")
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (func() bool {
		for i := 0; i+len(substr) <= len(s); i++ {
			if s[i:i+len(substr)] == substr {
				return true
			}
		}
		return false
	})()
}
