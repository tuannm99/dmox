package staticbuild

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/doctree"
	"github.com/tuannm99/dmox/internal/gitsvc"
	"github.com/tuannm99/dmox/internal/index"
	"github.com/tuannm99/dmox/internal/render"
	"github.com/tuannm99/dmox/internal/search"
	"github.com/tuannm99/dmox/internal/source"
	"github.com/tuannm99/dmox/internal/webassets"
)

type Options struct {
	WorkspaceID string
	OutDir      string
	BasePath    string
}

const basePathPlaceholder = "/__DMOX_BASE__/"

func Build(ctx context.Context, a *app.App, opts Options) error {
	ws, ok := a.Workspace(opts.WorkspaceID)
	if !ok {
		return fmt.Errorf("workspace %q not found", opts.WorkspaceID)
	}
	if err := os.MkdirAll(filepath.Join(opts.OutDir, "data", "files"), 0o755); err != nil {
		return fmt.Errorf("create output dir: %w", err)
	}

	for _, src := range ws.Sources {
		if err := src.Sync(ctx); err != nil {
			return fmt.Errorf("build: sync %s: %w", src.ID(), err)
		}
		if err := a.Indexer.IndexSource(ctx, opts.WorkspaceID, src); err != nil {
			return fmt.Errorf("build: index %s: %w", src.ID(), err)
		}
	}

	tree, err := doctree.Build(ctx, ws.Cfg.Name, ws.SourceIDs(), ws.Sources)
	if err != nil {
		return fmt.Errorf("build: tree: %w", err)
	}
	if err := writeJSON(filepath.Join(opts.OutDir, "data", "tree.json"), tree); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(opts.OutDir, "data", "workspaces.json"),
		[]map[string]string{{"id": ws.Cfg.ID, "name": ws.Cfg.Name}}); err != nil {
		return err
	}

	var leaves []string
	doctree.CollectLeaves(tree, &leaves)

	searchIndex := []search.Result{}
	aiContext := []map[string]string{}
	gitData := map[string]any{}

	for _, path := range leaves {
		sourceID, relPath, err := doctree.SplitSourcePath(path)
		if err != nil {
			return fmt.Errorf("build: %w", err)
		}
		src := ws.Sources[sourceID]
		raw, err := src.Read(ctx, relPath)
		if err != nil {
			return fmt.Errorf("build: read %s: %w", path, err)
		}
		if !source.IsIndexed(relPath) {
			fv := render.CodeFileView(path, raw, source.HighlightLanguage(filepath.Base(relPath)), 1<<20)
			if err := writeJSON(filepath.Join(opts.OutDir, "data", "files", path+".json"), fv); err != nil {
				return fmt.Errorf("build: write file json %s: %w", path, err)
			}
			continue
		}
		doc := index.Parse(raw, filepath.Base(relPath))
		body := a.PlantUML.RenderBlocks(ctx, doc.Body)
		isAI := index.IsAIContextFile(relPath)
		fv := render.FileView{
			Path: path, Title: doc.Title, Frontmatter: doc.Frontmatter, Body: body,
			Headings: render.ExtractHeadings(doc.Body), IsAIContext: isAI, Kind: "markdown",
		}
		if err := writeJSON(filepath.Join(opts.OutDir, "data", "files", path+".json"), fv); err != nil {
			return fmt.Errorf("build: write file json %s: %w", path, err)
		}
		searchIndex = append(searchIndex, search.Result{
			WorkspaceID: opts.WorkspaceID, SourceID: sourceID, Path: relPath, Title: doc.Title,
			Snippet: snippetOf(doc.Body),
		})
		if isAI {
			aiContext = append(aiContext, map[string]string{"source_id": sourceID, "path": relPath, "title": doc.Title})
		}

		if gitSrc, ok := src.(*source.GitSource); ok {
			commits, err := a.Git.History(gitSrc.MirrorDir(), relPath, 50)
			if err != nil {
				return fmt.Errorf("build: git history %s: %w", path, err)
			}
			gitData[path] = map[string]any{"applicable": true, "commits": commits}
			lines, err := a.Git.Blame(gitSrc.MirrorDir(), relPath)
			if err != nil {
				return fmt.Errorf("build: git blame %s: %w", path, err)
			}
			gitData[path+"#blame"] = map[string]any{"applicable": true, "lines": lines}
		} else {
			gitData[path] = map[string]any{"applicable": false, "commits": []gitsvc.Commit{}}
			gitData[path+"#blame"] = map[string]any{"applicable": false, "lines": []gitsvc.BlameLine{}}
		}
	}

	if err := writeJSON(filepath.Join(opts.OutDir, "data", "search-index.json"), searchIndex); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(opts.OutDir, "data", "ai-context.json"), aiContext); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(opts.OutDir, "data", "git-history.json"), gitData); err != nil {
		return err
	}

	if err := copySPAAssets(opts.OutDir, opts.BasePath); err != nil {
		return fmt.Errorf("build: copy spa assets: %w", err)
	}
	if err := writeRouteShells(opts.OutDir, leaves, opts.WorkspaceID); err != nil {
		return fmt.Errorf("build: route shells: %w", err)
	}
	return nil
}

func writeJSON(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func snippetOf(body string) string {
	plain := strings.Join(strings.Fields(body), " ")
	if len(plain) > 200 {
		return plain[:200] + "…"
	}
	return plain
}

var textExt = map[string]bool{".html": true, ".js": true, ".css": true, ".json": true, ".map": true}

func copySPAAssets(outDir, basePath string) error {
	if basePath == "" {
		basePath = "/"
	}
	if !strings.HasSuffix(basePath, "/") {
		basePath += "/"
	}
	assets, err := webassets.FS()
	if err != nil {
		return err
	}
	return fs.WalkDir(assets, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		dest := filepath.Join(outDir, p)
		if d.IsDir() {
			return os.MkdirAll(dest, 0o755)
		}
		data, err := fs.ReadFile(assets, p)
		if err != nil {
			return err
		}
		if textExt[filepath.Ext(p)] {
			data = bytes.ReplaceAll(data, []byte(basePathPlaceholder), []byte(basePath))
		}
		return os.WriteFile(dest, data, 0o644)
	})
}

func writeRouteShells(outDir string, leaves []string, workspaceID string) error {
	shell, err := os.ReadFile(filepath.Join(outDir, "index.html"))
	if err != nil {
		return fmt.Errorf("read root index.html: %w", err)
	}
	routes := []string{filepath.Join("w", workspaceID)}
	for _, path := range leaves {
		routes = append(routes, filepath.Join("w", workspaceID, "doc", path))
	}
	for _, route := range routes {
		dir := filepath.Join(outDir, route)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, "index.html"), shell, 0o644); err != nil {
			return err
		}
	}
	return nil
}
