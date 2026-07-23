package render

import (
	"strings"
	"testing"
)

func TestCodeFileView_SmallFile(t *testing.T) {
	fv := CodeFileView("local/main.go", []byte("package main"), "go", 1024)
	if fv.Kind != "code" {
		t.Fatalf("Kind = %q, want code", fv.Kind)
	}
	if fv.Language != "go" || fv.Body != "package main" {
		t.Fatalf("unexpected %+v", fv)
	}
	if fv.TooLargeToHighlight {
		t.Fatal("small file must not be flagged too large")
	}
	if fv.Title != "main.go" {
		t.Fatalf("Title = %q, want main.go", fv.Title)
	}
	if fv.Headings == nil || fv.Frontmatter == nil {
		t.Fatal("Headings/Frontmatter must be non-nil (empty) to avoid JSON null")
	}
}

func TestCodeFileView_TooLarge(t *testing.T) {
	big := strings.Repeat("x", 2048)
	fv := CodeFileView("local/big.log", []byte(big), "", 1024)
	if !fv.TooLargeToHighlight {
		t.Fatal("file over cap must be flagged")
	}
	if fv.Body != big {
		t.Fatal("body must still carry the full raw content")
	}
}
