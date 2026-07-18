package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFrontendFallback_ServesIndexHTMLForUnknownRoute(t *testing.T) {
	a := newTestApp(t)
	router := NewRouter(a)
	if err := MountFrontendForTest(router); err != nil {
		t.Fatalf("mount frontend: %v", err)
	}
	srv := httptest.NewServer(router)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/w/ws/doc/local/guide.md")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (SPA shell fallback)", resp.StatusCode)
	}
}

func TestFrontendFallback_APIRoutesStay404JSON(t *testing.T) {
	a := newTestApp(t)
	router := NewRouter(a)
	if err := MountFrontendForTest(router); err != nil {
		t.Fatalf("mount frontend: %v", err)
	}
	srv := httptest.NewServer(router)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/does-not-exist")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
	if resp.Header.Get("Content-Type") == "" {
		t.Fatal("expected a Content-Type header on the JSON 404")
	}
}
