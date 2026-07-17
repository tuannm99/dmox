package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/app"
)

func handleSearch(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := a.Workspace(c.Param("id")); !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		results, err := a.Search.Search(c.Request.Context(), c.Param("id"), c.Query("q"), 20)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if results == nil {
			c.JSON(http.StatusOK, []any{})
			return
		}
		c.JSON(http.StatusOK, results)
	}
}

func handleAIContext(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := a.Workspace(c.Param("id")); !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}
		rows, err := a.Store.DB().QueryContext(c.Request.Context(),
			`SELECT source_id, path, title FROM files WHERE workspace_id=? AND is_ai_context=1 ORDER BY source_id, path`,
			c.Param("id"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		type entry struct {
			SourceID string `json:"source_id"`
			Path     string `json:"path"`
			Title    string `json:"title"`
		}
		out := []entry{}
		for rows.Next() {
			var e entry
			if err := rows.Scan(&e.SourceID, &e.Path, &e.Title); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			out = append(out, e)
		}
		c.JSON(http.StatusOK, out)
	}
}
