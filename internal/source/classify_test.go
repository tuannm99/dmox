package source

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestClassify(t *testing.T) {
	cases := map[string]FileClass{
		"README.md": ClassDoc, "notes.markdown": ClassDoc,
		"main.go": ClassText, "app.ts": ClassText, "conf.yml": ClassText,
		"data.json": ClassText, "notes.txt": ClassText, "diagram.mmd": ClassText,
		"Dockerfile": ClassText, "Makefile": ClassText, "Jenkinsfile": ClassText,
		"logo.png": ClassUnsupported, "archive.zip": ClassUnsupported,
		"mystery": ClassUnsupported, "README.MD": ClassDoc, "MAIN.GO": ClassText,
	}
	for name, want := range cases {
		if got := Classify(name); got != want {
			t.Errorf("Classify(%q) = %d, want %d", name, got, want)
		}
	}
}

func TestViewableAndIndexed(t *testing.T) {
	if !IsViewable("main.go") || !IsViewable("README.md") {
		t.Fatal("code and docs must be viewable")
	}
	if IsViewable("logo.png") {
		t.Fatal("binary must not be viewable")
	}
	if !IsIndexed("README.md") {
		t.Fatal("docs must be indexed")
	}
	if IsIndexed("main.go") {
		t.Fatal("code must NOT be indexed in v1")
	}
}

func TestLocalSource_ListIncludesCodeExcludesBinary(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"guide.md", "main.go", "conf.yml", "logo.png"} {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	src := NewLocalSource("local", dir)
	files, err := src.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, f := range files {
		got[f.Path] = true
	}
	if !got["guide.md"] || !got["main.go"] || !got["conf.yml"] {
		t.Fatalf("want guide.md, main.go, conf.yml listed; got %v", got)
	}
	if got["logo.png"] {
		t.Fatal("binary logo.png must not be listed")
	}
}

func TestHighlightLanguage(t *testing.T) {
	cases := map[string]string{
		"main.go": "go", "app.ts": "typescript", "s.py": "python",
		"Dockerfile": "dockerfile", "conf.yml": "yaml", "x.json": "json",
		"mystery.xyz": "",
	}
	for name, want := range cases {
		if got := HighlightLanguage(name); got != want {
			t.Errorf("HighlightLanguage(%q) = %q, want %q", name, got, want)
		}
	}
}
