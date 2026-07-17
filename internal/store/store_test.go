package store

import (
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
