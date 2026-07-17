package main

import (
	"flag"
	"fmt"
	"log"
	"net/url"

	"github.com/tuannm99/dmox/internal/doctree"
	"github.com/tuannm99/dmox/internal/render"
)

func runContextCmd(args []string) {
	fs := flag.NewFlagSet("context", flag.ExitOnError)
	workspace := fs.String("workspace", "", "workspace id")
	filter := fs.String("filter", "ai", "ai|all")
	fs.Parse(args)
	if *workspace == "" {
		log.Fatal("dmox context: --workspace is required")
	}

	var targets []string
	switch *filter {
	case "all":
		var root doctree.TreeNode
		if err := apiGet("/api/workspaces/"+*workspace+"/tree", &root); err != nil {
			log.Fatal(err)
		}
		collectLeaves(root, &targets)
	default:
		var entries []struct {
			SourceID string `json:"source_id"`
			Path     string `json:"path"`
			Title    string `json:"title"`
		}
		if err := apiGet("/api/workspaces/"+*workspace+"/ai-context", &entries); err != nil {
			log.Fatal(err)
		}
		for _, e := range entries {
			targets = append(targets, e.SourceID+"/"+e.Path)
		}
	}

	for _, t := range targets {
		var fv render.FileView
		if err := apiGet("/api/workspaces/"+*workspace+"/file?path="+url.QueryEscape(t), &fv); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("\n---\n# %s (%s)\n\n%s\n", fv.Title, fv.Path, fv.Body)
	}
}

func collectLeaves(node doctree.TreeNode, out *[]string) {
	if !node.IsDir {
		*out = append(*out, node.Path)
		return
	}
	for _, c := range node.Children {
		collectLeaves(c, out)
	}
}
