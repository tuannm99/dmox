package webassets

import "testing"

func TestFS_ReturnsValidFilesystem(t *testing.T) {
	fsys, err := FS()
	if err != nil {
		t.Fatalf("FS: %v", err)
	}
	if _, err := fsys.Open("index.html"); err != nil {
		t.Fatalf("expected index.html in embedded assets: %v", err)
	}
}
