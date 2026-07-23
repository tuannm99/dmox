package source

import "testing"

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
