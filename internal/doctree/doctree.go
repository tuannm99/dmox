package doctree

import (
	"context"
	"fmt"
	"strings"

	"github.com/tuannm99/dmox/internal/source"
)

type TreeNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	IsDir    bool       `json:"is_dir"`
	Children []TreeNode `json:"children,omitempty"`
}

func Insert(root *TreeNode, sourceID, relPath string) {
	parts := strings.Split(relPath, "/")
	cur := root
	for i, part := range parts {
		isDir := i < len(parts)-1
		var next *TreeNode
		for idx := range cur.Children {
			if cur.Children[idx].Name == part {
				next = &cur.Children[idx]
				break
			}
		}
		if next == nil {
			cur.Children = append(cur.Children, TreeNode{
				Name: part, Path: sourceID + "/" + strings.Join(parts[:i+1], "/"), IsDir: isDir,
			})
			next = &cur.Children[len(cur.Children)-1]
		}
		cur = next
	}
}

func SplitSourcePath(path string) (sourceID, relPath string, err error) {
	idx := strings.Index(path, "/")
	if idx < 0 {
		return "", "", fmt.Errorf("path %q missing source prefix", path)
	}
	return path[:idx], path[idx+1:], nil
}

// Build merges every source in a workspace into one tree, mounted by source ID.
// A source that fails to List() is skipped rather than failing the whole tree
// (spec §5: the rest of the workspace keeps functioning off the last-known-good index).
func Build(ctx context.Context, rootName string, sourceIDs []string, sources map[string]source.Source) (TreeNode, error) {
	root := TreeNode{Name: rootName, Path: "", IsDir: true}
	for _, sid := range sourceIDs {
		src := sources[sid]
		files, err := src.List(ctx)
		if err != nil {
			continue
		}
		mount := TreeNode{Name: sid, Path: sid, IsDir: true}
		for _, f := range files {
			Insert(&mount, sid, f.Path)
		}
		root.Children = append(root.Children, mount)
	}
	return root, nil
}

func CollectLeaves(node TreeNode, out *[]string) {
	if !node.IsDir {
		*out = append(*out, node.Path)
		return
	}
	for _, c := range node.Children {
		CollectLeaves(c, out)
	}
}
