package config

import (
	"os"
	"path/filepath"
	"testing"
)

func writeTemp(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoad_ValidConfig(t *testing.T) {
	path := writeTemp(t, `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: local-docs
        type: local
        path: ./docs
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.Workspaces) != 1 || cfg.Workspaces[0].ID != "docs" {
		t.Fatalf("unexpected workspaces: %+v", cfg.Workspaces)
	}
	if cfg.Server.Addr != ":8080" {
		t.Fatalf("expected default server addr :8080, got %q", cfg.Server.Addr)
	}
	if cfg.Workspaces[0].Sources[0].Branch != "" {
		t.Fatalf("local source should not get a branch default")
	}
}

func TestLoad_DefaultsGitBranch(t *testing.T) {
	path := writeTemp(t, `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: repo
        type: git
        url: https://example.com/repo.git
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Workspaces[0].Sources[0].Branch != "main" {
		t.Fatalf("expected default branch main, got %q", cfg.Workspaces[0].Sources[0].Branch)
	}
}

func TestLoad_Errors(t *testing.T) {
	cases := map[string]string{
		"missing workspace id": `
workspaces:
  - name: Docs
    sources:
      - id: s
        type: local
        path: ./docs`,
		"duplicate workspace id": `
workspaces:
  - id: docs
    name: A
    sources: [{id: s, type: local, path: ./a}]
  - id: docs
    name: B
    sources: [{id: s2, type: local, path: ./b}]`,
		"unknown source type": `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: s
        type: ftp
        path: ./docs`,
		"local missing path": `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: s
        type: local`,
		"git missing url": `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: s
        type: git`,
	}
	for name, yamlContent := range cases {
		t.Run(name, func(t *testing.T) {
			path := writeTemp(t, yamlContent)
			if _, err := Load(path); err == nil {
				t.Fatalf("expected error for case %q", name)
			}
		})
	}
}

func TestLoad_FileNotFound(t *testing.T) {
	if _, err := Load("/nonexistent/config.yaml"); err == nil {
		t.Fatal("expected error for missing file")
	}
}
