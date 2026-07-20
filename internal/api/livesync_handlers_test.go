package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tuannm99/dmox/internal/livesync"
)

func TestAPI_WorkspaceEvents_StreamsPublishedChange(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/workspaces/ws/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /events: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	lines := make(chan string, 8)
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
	}()

	a.Events.Publish("ws", livesync.Event{SourceID: "local", Path: "guide.md", Op: "modify"})

	deadline := time.After(3 * time.Second)
	for {
		select {
		case line := <-lines:
			if strings.Contains(line, `"path":"guide.md"`) && strings.Contains(line, `"op":"modify"`) {
				return
			}
		case <-deadline:
			t.Fatal("timed out waiting for the SSE change event")
		}
	}
}

func TestAPI_WorkspaceEvents_UnknownWorkspace(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/nope/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestAPI_FileDiff_AvailableAfterRecord(t *testing.T) {
	a := newTestApp(t)
	a.Diffs.Record("ws", "local", "guide.md", "old body", "new body")
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/file/diff?path=guide.md&source=local")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out["available"] != true {
		t.Fatalf("available = %v, want true", out["available"])
	}
	if out["old"] != "old body" || out["new"] != "new body" {
		t.Fatalf("diff = %+v", out)
	}
}

func TestAPI_FileDiff_UnavailableWhenNeverRecorded(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspaces/ws/file/diff?path=guide.md&source=local")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out["available"] != false {
		t.Fatalf("available = %v, want false", out["available"])
	}
}
