package index

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tuannm99/dmox/internal/source"
	"github.com/tuannm99/dmox/internal/store"
)

func TestIndexSource_SkipsNonDocFiles(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("guide.md", "# Guide\nhello")
	write("main.go", "package main\nfunc main(){}")

	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ix := New(st)
	src := source.NewLocalSource("local", dir)
	if err := ix.IndexSource(context.Background(), "ws", src); err != nil {
		t.Fatal(err)
	}

	var n int
	if err := st.DB().QueryRow(`SELECT COUNT(*) FROM files WHERE workspace_id='ws'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("indexed %d files, want 1 (only guide.md; main.go must be skipped)", n)
	}
}
