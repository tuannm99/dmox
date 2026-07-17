package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

const validYAML = `
workspaces:
  - id: docs
    name: Docs
    sources:
      - id: s
        type: local
        path: ./docs
`

const validYAMLv2 = `
workspaces:
  - id: docs
    name: Docs v2
    sources:
      - id: s
        type: local
        path: ./docs
`

func TestManager_ReloadsOnChange(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(validYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := NewManager(path)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer m.Close()

	if got := m.Get().Workspaces[0].Name; got != "Docs" {
		t.Fatalf("initial name = %q, want Docs", got)
	}

	sub := m.Subscribe()
	if err := os.WriteFile(path, []byte(validYAMLv2), 0o644); err != nil {
		t.Fatal(err)
	}

	select {
	case cfg := <-sub:
		if cfg.Workspaces[0].Name != "Docs v2" {
			t.Fatalf("reloaded name = %q, want %q", cfg.Workspaces[0].Name, "Docs v2")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for reload notification")
	}
	if got := m.Get().Workspaces[0].Name; got != "Docs v2" {
		t.Fatalf("Get() after reload = %q, want Docs v2", got)
	}
}

func TestManager_KeepsOldConfigOnInvalidReload(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(validYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := NewManager(path)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer m.Close()

	if err := os.WriteFile(path, []byte("not: [valid yaml"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(500 * time.Millisecond)
	if got := m.Get().Workspaces[0].Name; got != "Docs" {
		t.Fatalf("Get() after invalid reload = %q, want unchanged Docs", got)
	}
}
