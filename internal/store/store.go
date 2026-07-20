package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	db, err := sql.Open("sqlite3", path+"?_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1) // sqlite is single-writer; avoid SQLITE_BUSY under concurrent handlers
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

const schema = `
CREATE TABLE IF NOT EXISTS files (
    workspace_id  TEXT NOT NULL,
    source_id     TEXT NOT NULL,
    path          TEXT NOT NULL,
    title         TEXT,
    frontmatter   TEXT,
    body          TEXT NOT NULL,
    is_ai_context INTEGER NOT NULL DEFAULT 0,
    mtime         INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, source_id, path)
);

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    path, title, body,
    content='files', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
    INSERT INTO files_fts(rowid, path, title, body) VALUES (new.rowid, new.path, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, path, title, body) VALUES ('delete', old.rowid, old.path, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, path, title, body) VALUES ('delete', old.rowid, old.path, old.title, old.body);
    INSERT INTO files_fts(rowid, path, title, body) VALUES (new.rowid, new.path, new.title, new.body);
END;
`

func (s *Store) migrate() error {
	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("migrate schema: %w", err)
	}
	return nil
}

func (s *Store) DB() *sql.DB  { return s.db }
func (s *Store) Close() error { return s.db.Close() }

// GetFileBody returns the currently indexed body for a file, or ok=false if
// no such row exists (never indexed, or already removed).
func (s *Store) GetFileBody(ctx context.Context, workspaceID, sourceID, path string) (body string, ok bool, err error) {
	err = s.db.QueryRowContext(ctx,
		`SELECT body FROM files WHERE workspace_id=? AND source_id=? AND path=?`,
		workspaceID, sourceID, path,
	).Scan(&body)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return body, true, nil
}
