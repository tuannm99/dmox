package api

import (
	"bytes"
	"io/fs"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/app"
)

func NewRouter(a *app.App) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery(), gin.Logger(), corsMiddleware())
	g := r.Group("/api")
	g.GET("/workspaces", handleListWorkspaces(a))
	g.GET("/keymap", handleKeymap(a))
	g.GET("/workspaces/:id/tree", handleTree(a))
	g.GET("/workspaces/:id/file", handleFile(a))
	g.GET("/workspaces/:id/search", handleSearch(a))
	g.GET("/workspaces/:id/ai-context", handleAIContext(a))
	g.GET("/workspaces/:id/git/history", handleGitHistory(a))
	g.GET("/workspaces/:id/git/blame", handleGitBlame(a))
	g.POST("/sources/:id/pull", handleSourcePull(a))
	g.GET("/workspaces/:id/terminal/ws", handleTerminalWS(a))
	return r
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// basePathPlaceholder is the literal token the frontend build bakes into every
// asset URL (see web/vite.config.ts's `base` and internal/staticbuild's
// substitution for `dmox build`). `dmox serve` always serves at the root path,
// so it substitutes the token for "/" itself rather than requiring a build step.
const basePathPlaceholder = "/__DMOX_BASE__/"

// textAssetExt lists extensions that may contain the base-path placeholder and
// therefore need substitution rather than being served byte-for-byte.
var textAssetExt = map[string]bool{".html": true, ".js": true, ".css": true, ".json": true, ".map": true}

func MountFrontend(r *gin.Engine, assets fs.FS) {
	fileServer := http.FileServer(http.FS(assets))
	r.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		reqPath := strings.TrimPrefix(c.Request.URL.Path, "/")
		if reqPath == "" {
			reqPath = "index.html"
		}
		if _, err := fs.Stat(assets, reqPath); err != nil {
			reqPath = "index.html" // SPA fallback: unknown client-side routes serve the shell
		}
		if textAssetExt[filepath.Ext(reqPath)] {
			data, err := fs.ReadFile(assets, reqPath)
			if err == nil {
				data = bytes.ReplaceAll(data, []byte(basePathPlaceholder), []byte("/"))
				c.Data(http.StatusOK, mimeType(reqPath), data)
				return
			}
		}
		c.Request.URL.Path = "/" + reqPath
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}

func mimeType(path string) string {
	switch filepath.Ext(path) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".json":
		return "application/json"
	case ".map":
		return "application/json"
	default:
		return "application/octet-stream"
	}
}
