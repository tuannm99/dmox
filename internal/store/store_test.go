package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestOpen_MigratesSchemaAndFTSWorks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dmox.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	_, err = s.DB().Exec(`INSERT INTO files (workspace_id, source_id, path, title, frontmatter, body, is_ai_context, mtime)
		VALUES ('ws', 'src', 'guide.md', 'Guide', '{}', 'hello world getting started', 0, 0)`)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}

	rows, err := s.DB().Query(`SELECT f.path FROM files_fts JOIN files f ON f.rowid = files_fts.rowid WHERE files_fts MATCH 'getting'`)
	if err != nil {
		t.Fatalf("fts query: %v", err)
	}
	defer rows.Close()
	var paths []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, p)
	}
	if len(paths) != 1 || paths[0] != "guide.md" {
		t.Fatalf("fts results = %+v", paths)
	}
}

func TestOpen_CreatesDataDir(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "dir", "dmox.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()
}

func TestStore_GetFileBody_FoundAndNotFound(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "dmox.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	ctx := context.Background()
	_, err = s.DB().ExecContext(ctx,
		`INSERT INTO files (workspace_id, source_id, path, title, frontmatter, body, is_ai_context, mtime)
		 VALUES ('ws', 'local', 'guide.md', 'Guide', '{}', 'hello world', 0, 0)`)
	if err != nil {
		t.Fatalf("seed insert: %v", err)
	}

	body, ok, err := s.GetFileBody(ctx, "ws", "local", "guide.md")
	if err != nil {
		t.Fatalf("GetFileBody: %v", err)
	}
	if !ok || body != "hello world" {
		t.Fatalf("GetFileBody = (%q, %v), want (%q, true)", body, ok, "hello world")
	}

	_, ok, err = s.GetFileBody(ctx, "ws", "local", "nope.md")
	if err != nil {
		t.Fatalf("GetFileBody (missing): %v", err)
	}
	if ok {
		t.Fatal("expected ok=false for a path that was never indexed")
	}
}
