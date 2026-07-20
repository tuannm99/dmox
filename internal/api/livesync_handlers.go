package api

import (
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/app"
)

// handleWorkspaceEvents streams livesync.Hub events for a workspace as
// Server-Sent Events. Headers are flushed immediately on connect (before
// any event exists to write) so both callers relying on prompt connection
// establishment behave correctly: the browser EventSource's onopen fires
// right away (the frontend treats onopen as its "just (re)connected, maybe
// resync" signal), and an httptest client's Do() doesn't block waiting for
// the first byte.
func handleWorkspaceEvents(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		wsID := c.Param("id")
		if _, ok := a.Workspace(wsID); !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}

		events, cancel := a.Events.Subscribe(wsID)
		defer cancel()

		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Writer.WriteHeaderNow()
		c.Writer.Flush()

		c.Stream(func(w io.Writer) bool {
			select {
			case ev, ok := <-events:
				if !ok {
					return false
				}
				c.SSEvent("change", ev)
				return true
			case <-c.Request.Context().Done():
				return false
			}
		})
	}
}

// handleFileDiff serves and consumes a pending DiffCache entry. ?source= is
// optional and defaults to the workspace's first local source, matching how
// handleTerminalWS resolves a source — diffs only ever apply to
// locally-watched files.
func handleFileDiff(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		wsID := c.Param("id")
		ws, ok := a.Workspace(wsID)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}

		sourceID := c.Query("source")
		if sourceID == "" {
			if ls := findLocalSource(ws, ""); ls != nil {
				sourceID = ls.ID()
			}
		}
		path := c.Query("path")

		old, new_, available := a.Diffs.Consume(wsID, sourceID, path)
		if !available {
			c.JSON(http.StatusOK, gin.H{"available": false})
			return
		}
		c.JSON(http.StatusOK, gin.H{"available": true, "old": old, "new": new_})
	}
}
