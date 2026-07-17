package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"strings"

	"github.com/tuannm99/dmox/internal/doctree"
)

func runTreeCmd(args []string) {
	fs := flag.NewFlagSet("tree", flag.ExitOnError)
	workspace := fs.String("workspace", "", "workspace id")
	format := fs.String("format", "text", "output format: text|json")
	fs.Parse(args)
	if *workspace == "" {
		log.Fatal("dmox tree: --workspace is required")
	}
	var root doctree.TreeNode
	if err := apiGet("/api/workspaces/"+*workspace+"/tree", &root); err != nil {
		log.Fatal(err)
	}
	switch *format {
	case "json":
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		enc.Encode(root)
	default:
		printTreeText(os.Stdout, root, 0)
	}
}

func printTreeText(w io.Writer, node doctree.TreeNode, depth int) {
	if depth > 0 {
		fmt.Fprintf(w, "%s%s\n", strings.Repeat("  ", depth-1), node.Name)
	}
	for _, c := range node.Children {
		printTreeText(w, c, depth+1)
	}
}
