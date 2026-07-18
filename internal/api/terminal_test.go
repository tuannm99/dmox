package api

import (
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestTerminalWS_RunsShellInLocalSourceRoot(t *testing.T) {
	os.Setenv("SHELL", "/bin/bash")
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/workspaces/ws/terminal/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteMessage(websocket.BinaryMessage, []byte("pwd\n")); err != nil {
		t.Fatalf("write: %v", err)
	}

	localRoot := a.Workspaces["ws"].Sources["local"].(interface{ Root() string }).Root()

	deadline := time.Now().Add(5 * time.Second)
	conn.SetReadDeadline(deadline)
	var collected strings.Builder
	for time.Now().Before(deadline) {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		collected.Write(data)
		if strings.Contains(collected.String(), localRoot) {
			return // found expected pwd output
		}
	}
	t.Fatalf("expected terminal output to contain local source root %q, got: %q", localRoot, collected.String())
}

func TestTerminalWS_UnknownWorkspace(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/workspaces/nope/terminal/ws"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatal("expected dial to fail for unknown workspace")
	}
	if resp == nil || resp.StatusCode != 404 {
		t.Fatalf("expected 404 response, got %+v", resp)
	}
}
