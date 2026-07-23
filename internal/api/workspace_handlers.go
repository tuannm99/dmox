package api

import (
	"net/http"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/doctree"
	"github.com/tuannm99/dmox/internal/index"
	"github.com/tuannm99/dmox/internal/render"
	"github.com/tuannm99/dmox/internal/source"
)

func handleListWorkspaces(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		out := make([]gin.H, 0, len(a.Cfg.Workspaces))
		for _, w := range a.Cfg.Workspaces {
			out = append(out, gin.H{"id": w.ID, "name": w.Name})
		}
		c.JSON(http.StatusOK, out)
	}
}

func handleTree(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		ws, ok := a.Workspace(c.Param("id"))
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		tree, err := doctree.Build(c.Request.Context(), ws.Cfg.Name, ws.SourceIDs(), ws.Sources)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, tree)
	}
}

func handleFile(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		ws, ok := a.Workspace(c.Param("id"))
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		path := c.Query("path")
		sourceID, relPath, err := doctree.SplitSourcePath(path)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		src, ok := ws.Sources[sourceID]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "source not found"})
			return
		}
		raw, err := src.Read(c.Request.Context(), relPath)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		base := filepath.Base(relPath)
		switch source.Classify(base) {
		case source.ClassText:
			c.JSON(http.StatusOK, render.CodeFileView(
				path, raw, source.HighlightLanguage(base), render.MaxHighlightBytes))
			return
		case source.ClassUnsupported:
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		doc := index.Parse(raw, base)
		body := a.PlantUML.RenderBlocks(c.Request.Context(), doc.Body)
		c.JSON(http.StatusOK, render.FileView{
			Path: path, Title: doc.Title, Frontmatter: doc.Frontmatter, Body: body,
			Headings: render.ExtractHeadings(doc.Body), IsAIContext: index.IsAIContextFile(relPath),
			Kind: "markdown",
		})
	}
}
