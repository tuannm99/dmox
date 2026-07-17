package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestApiGet_DecodesJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ok": true}`))
	}))
	defer srv.Close()
	os.Setenv("DMOX_API_URL", srv.URL)
	defer os.Unsetenv("DMOX_API_URL")

	var out struct {
		OK bool `json:"ok"`
	}
	if err := apiGet("/anything", &out); err != nil {
		t.Fatalf("apiGet: %v", err)
	}
	if !out.OK {
		t.Fatal("expected ok=true")
	}
}

func TestApiGet_ErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("not found"))
	}))
	defer srv.Close()
	os.Setenv("DMOX_API_URL", srv.URL)
	defer os.Unsetenv("DMOX_API_URL")

	var out struct{}
	if err := apiGet("/x", &out); err == nil {
		t.Fatal("expected error for 404 response")
	}
}

func TestApiGet_ConnectionRefused(t *testing.T) {
	os.Setenv("DMOX_API_URL", "http://127.0.0.1:1")
	defer os.Unsetenv("DMOX_API_URL")
	var out struct{}
	err := apiGet("/x", &out)
	if err == nil {
		t.Fatal("expected connection error")
	}
}
