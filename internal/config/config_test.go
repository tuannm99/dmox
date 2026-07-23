package config

import (
	"os"
	"path/filepath"
	"strings"
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

func TestLoad_ExpandsTildeDataDir(t *testing.T) {
	path := writeTemp(t, `
data_dir: ~/.dmox
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
	if strings.Contains(cfg.DataDir, "~") {
		t.Fatalf("expected data_dir to not contain '~', got %q", cfg.DataDir)
	}
	if !filepath.IsAbs(cfg.DataDir) {
		t.Fatalf("expected data_dir to be absolute, got %q", cfg.DataDir)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("os.UserHomeDir: %v", err)
	}
	want := filepath.Join(home, ".dmox")
	if cfg.DataDir != want {
		t.Fatalf("expected data_dir %q, got %q", want, cfg.DataDir)
	}
}

func TestLoad_ExpandsBareTildeDataDir(t *testing.T) {
	path := writeTemp(t, `
data_dir: "~"
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
	if strings.Contains(cfg.DataDir, "~") {
		t.Fatalf("expected data_dir to not contain '~', got %q", cfg.DataDir)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("os.UserHomeDir: %v", err)
	}
	if cfg.DataDir != home {
		t.Fatalf("expected data_dir %q, got %q", home, cfg.DataDir)
	}
}

func TestLoad_WorkspaceRootResolvesRelativeSourcePaths(t *testing.T) {
	path := writeTemp(t, `
workspace_root: /srv/repos
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: a
        type: local
        path: podzone/docs
      - id: b
        type: local
        path: ./rust-proxy-handbook
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := cfg.Workspaces[0].Sources[0].Path; got != "/srv/repos/podzone/docs" {
		t.Fatalf("source a: expected /srv/repos/podzone/docs, got %q", got)
	}
	if got := cfg.Workspaces[0].Sources[1].Path; got != "/srv/repos/rust-proxy-handbook" {
		t.Fatalf("source b: expected /srv/repos/rust-proxy-handbook, got %q", got)
	}
}

func TestLoad_WorkspaceRootLeavesAbsoluteSourcePaths(t *testing.T) {
	path := writeTemp(t, `
workspace_root: /srv/repos
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: a
        type: local
        path: /home/me/dev/dmox
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := cfg.Workspaces[0].Sources[0].Path; got != "/home/me/dev/dmox" {
		t.Fatalf("expected absolute path unchanged, got %q", got)
	}
}

func TestLoad_NoWorkspaceRootKeepsRelativePaths(t *testing.T) {
	// Backward compat: without workspace_root, a relative path is left as-is
	// and resolves against the process working dir, exactly as before.
	path := writeTemp(t, `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: a
        type: local
        path: ../podzone/docs
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := cfg.Workspaces[0].Sources[0].Path; got != "../podzone/docs" {
		t.Fatalf("expected relative path unchanged, got %q", got)
	}
}

func TestLoad_WorkspaceRootExpandsTilde(t *testing.T) {
	path := writeTemp(t, `
workspace_root: ~/dev/local
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: a
        type: local
        path: podzone/docs
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("os.UserHomeDir: %v", err)
	}
	want := filepath.Join(home, "dev/local", "podzone/docs")
	if got := cfg.Workspaces[0].Sources[0].Path; got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestLoad_WorkspaceRootEnvOverridesConfig(t *testing.T) {
	// The same config.yaml must work on the host and inside the container:
	// DMOX_WORKSPACE_ROOT wins over the file's workspace_root so `docker
	// compose` can point relative sources at the single mounted parent dir.
	t.Setenv("DMOX_WORKSPACE_ROOT", "/workspaces")
	path := writeTemp(t, `
workspace_root: /home/me/dev/local
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: a
        type: local
        path: podzone/docs
`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := cfg.Workspaces[0].Sources[0].Path; got != "/workspaces/podzone/docs" {
		t.Fatalf("expected env root to win: /workspaces/podzone/docs, got %q", got)
	}
}

func TestLoad_AbsoluteDataDirUnchanged(t *testing.T) {
	path := writeTemp(t, `
data_dir: /var/lib/dmox
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
	if cfg.DataDir != "/var/lib/dmox" {
		t.Fatalf("expected data_dir unchanged %q, got %q", "/var/lib/dmox", cfg.DataDir)
	}
}
