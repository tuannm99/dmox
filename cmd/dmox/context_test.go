package main

import (
	"testing"

	"github.com/tuannm99/dmox/internal/doctree"
)

func TestCollectLeaves(t *testing.T) {
	tree := doctree.TreeNode{
		IsDir: true,
		Children: []doctree.TreeNode{
			{Name: "a.md", Path: "local/a.md", IsDir: false},
			{Name: "dir", IsDir: true, Children: []doctree.TreeNode{
				{Name: "b.md", Path: "local/dir/b.md", IsDir: false},
			}},
		},
	}
	var out []string
	collectLeaves(tree, &out)
	if len(out) != 2 {
		t.Fatalf("leaves = %+v, want 2", out)
	}
}
