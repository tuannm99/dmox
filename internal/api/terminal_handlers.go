package api

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/source"
	"github.com/tuannm99/dmox/internal/terminal"
)

// terminalUpgrader has no origin check: dmox is a local-first, no-auth tool
// and this endpoint spawns a real shell — it must never be exposed beyond
// localhost. See README's "Local development" security note.
var terminalUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type terminalClientMsg struct {
	Type string `json:"type"`
	Rows uint16 `json:"rows"`
	Cols uint16 `json:"cols"`
}

// handleTerminalWS opens a PTY-backed shell rooted at a workspace's local
// source directory (?source=<id> selects one; the first local source is used
// otherwise) and bridges it over a WebSocket: binary frames are raw
// stdin/stdout, text frames carry {"type":"resize","rows":R,"cols":C}.
func handleTerminalWS(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		ws, ok := a.Workspace(c.Param("id"))
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
			return
		}

		localSrc := findLocalSource(ws, c.Query("source"))
		if localSrc == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "workspace has no local source to open a terminal in"})
			return
		}

		conn, err := terminalUpgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Printf("terminal: websocket upgrade failed: %v", err)
			return
		}
		defer conn.Close()

		sess, err := terminal.Start(localSrc.Root())
		if err != nil {
			log.Printf("terminal: failed to start shell: %v", err)
			return
		}
		defer sess.Close()

		go pumpSessionToWS(sess, conn)
		pumpWSToSession(conn, sess)
	}
}

func findLocalSource(ws *app.Workspace, sourceID string) *source.LocalSource {
	if sourceID != "" {
		src, ok := ws.Sources[sourceID]
		if !ok {
			return nil
		}
		ls, _ := src.(*source.LocalSource)
		return ls
	}
	for _, scfg := range ws.Cfg.Sources {
		if ls, ok := ws.Sources[scfg.ID].(*source.LocalSource); ok {
			return ls
		}
	}
	return nil
}

func pumpSessionToWS(sess *terminal.Session, conn *websocket.Conn) {
	buf := make([]byte, 4096)
	for {
		n, err := sess.Read(buf)
		if n > 0 {
			if werr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func pumpWSToSession(conn *websocket.Conn, sess *terminal.Session) {
	for {
		msgType, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if msgType == websocket.TextMessage {
			var msg terminalClientMsg
			if json.Unmarshal(data, &msg) == nil && msg.Type == "resize" {
				_ = sess.Resize(msg.Rows, msg.Cols)
				continue
			}
		}
		if _, err := sess.Write(data); err != nil {
			return
		}
	}
}
