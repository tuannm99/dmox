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

// handleGitStatus reports the branch and per-file status of the checkout a
// local source lives in. This is the counterpart of history/blame: those need
// a GitSource's mirrored clone, this needs a real working tree, so a source
// that is the wrong kind reports applicable:false rather than erroring.
func handleGitStatus(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		ws, ok := a.Workspace(c.Param("id"))
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		out := gin.H{}
		sources := make(map[string]gitsvc.WorkingTreeStatus, len(ws.Sources))
		for id, src := range ws.Sources {
			local, ok := src.(*source.LocalSource)
			if !ok {
				sources[id] = gitsvc.WorkingTreeStatus{Files: []gitsvc.FileStatus{}}
				continue
			}
			st, err := a.Git.WorkingTree(local.Root())
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			// A source root usually holds far more than docs (code, configs,
			// dotfiles). Reporting those would put entries in the sidebar that
			// have no corresponding node in the doc tree, so nothing to badge
			// and nothing to open. Keep only files that have a node in the tree
			// (docs + viewable code/config).
			docs := make([]gitsvc.FileStatus, 0, len(st.Files))
			for _, f := range st.Files {
				if source.IsViewable(f.Path) {
					docs = append(docs, f)
				}
			}
			st.Files = docs
			sources[id] = st
		}
		out["sources"] = sources
		c.JSON(http.StatusOK, out)
	}
}

// handleGitWorkingDiff returns a file's committed version next to its on-disk
// version, in the same shape as the live-reload diff so both render through
// one modal on the frontend.
func handleGitWorkingDiff(a *app.App) gin.HandlerFunc {
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
		local, ok := src.(*source.LocalSource)
		if !ok {
			c.JSON(http.StatusOK, gitsvc.WorkingTreeDiff{})
			return
		}
		diff, err := a.Git.WorkingTreeDiff(local.Root(), relPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, diff)
	}
}
