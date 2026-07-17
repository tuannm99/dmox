package main

import (
	"bytes"
	"testing"

	"github.com/tuannm99/dmox/internal/doctree"
)

func TestPrintTreeText(t *testing.T) {
	tree := doctree.TreeNode{
		Name: "WS", IsDir: true,
		Children: []doctree.TreeNode{
			{Name: "local", IsDir: true, Children: []doctree.TreeNode{
				{Name: "guide.md", Path: "local/guide.md", IsDir: false},
			}},
		},
	}
	var buf bytes.Buffer
	printTreeText(&buf, tree, 0)
	got := buf.String()
	if !bytes.Contains([]byte(got), []byte("local")) || !bytes.Contains([]byte(got), []byte("guide.md")) {
		t.Fatalf("output = %q", got)
	}
}
