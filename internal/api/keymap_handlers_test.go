package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAPI_Keymap_EmptyWhenNotConfigured(t *testing.T) {
	a := newTestApp(t)
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/keymap")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	if len(out) != 0 {
		t.Fatalf("keymap = %+v, want empty", out)
	}
}

func TestAPI_Keymap_ReturnsConfiguredOverrides(t *testing.T) {
	a := newTestApp(t)
	a.Cfg.Keymap = map[string]string{"terminal": "mod+j"}
	srv := httptest.NewServer(NewRouter(a))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/keymap")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	if out["terminal"] != "mod+j" {
		t.Fatalf("keymap = %+v, want terminal=mod+j", out)
	}
}
