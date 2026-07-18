package api

import (
	"io/fs"
	"net/http"
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
	g.GET("/workspaces/:id/tree", handleTree(a))
	g.GET("/workspaces/:id/file", handleFile(a))
	g.GET("/workspaces/:id/search", handleSearch(a))
	g.GET("/workspaces/:id/ai-context", handleAIContext(a))
	g.GET("/workspaces/:id/git/history", handleGitHistory(a))
	g.GET("/workspaces/:id/git/blame", handleGitBlame(a))
	g.POST("/sources/:id/pull", handleSourcePull(a))
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
			c.Request.URL.Path = "/" // SPA fallback: unknown client-side routes serve the shell
		}
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}
