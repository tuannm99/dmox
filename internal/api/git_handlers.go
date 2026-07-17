package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/doctree"
	"github.com/tuannm99/dmox/internal/gitsvc"
	"github.com/tuannm99/dmox/internal/source"
)

func handleGitHistory(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		ws, ok := a.Workspace(c.Param("id"))
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		sourceID, relPath, err := doctree.SplitSourcePath(c.Query("path"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		src, ok := ws.Sources[sourceID]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "source not found"})
			return
		}
		gitSrc, ok := src.(*source.GitSource)
		if !ok {
			c.JSON(http.StatusOK, gin.H{"applicable": false, "commits": []gitsvc.Commit{}})
			return
		}
		commits, err := a.Git.History(gitSrc.MirrorDir(), relPath, 50)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"applicable": true, "commits": commits})
	}
}

func handleGitBlame(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		ws, ok := a.Workspace(c.Param("id"))
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		sourceID, relPath, err := doctree.SplitSourcePath(c.Query("path"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		src, ok := ws.Sources[sourceID]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "source not found"})
			return
		}
		gitSrc, ok := src.(*source.GitSource)
		if !ok {
			c.JSON(http.StatusOK, gin.H{"applicable": false, "lines": []gitsvc.BlameLine{}})
			return
		}
		lines, err := a.Git.Blame(gitSrc.MirrorDir(), relPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"applicable": true, "lines": lines})
	}
}

func handleSourcePull(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		sourceID := c.Param("id")
		for wsID, ws := range a.Workspaces {
			src, ok := ws.Sources[sourceID]
			if !ok {
				continue
			}
			if err := src.Sync(c.Request.Context()); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := a.Indexer.IndexSource(c.Request.Context(), wsID, src); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "ok"})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "source not found"})
	}
}
