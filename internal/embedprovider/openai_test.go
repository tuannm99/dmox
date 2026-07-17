package embedprovider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAIProvider_Embed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("missing/incorrect auth header: %q", r.Header.Get("Authorization"))
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "text-embedding-3-small" {
			t.Errorf("model = %v", body["model"])
		}
		json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{
				{"embedding": []float32{0.1, 0.2, 0.3}},
			},
		})
	}))
	defer srv.Close()

	p := NewOpenAIProvider("test-key", "text-embedding-3-small")
	p.SetBaseURL(srv.URL)
	vecs, err := p.Embed(context.Background(), []string{"hello"})
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if len(vecs) != 1 || len(vecs[0]) != 3 {
		t.Fatalf("vecs = %+v", vecs)
	}
}

func TestOpenAIProvider_Embed_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("invalid api key"))
	}))
	defer srv.Close()

	p := NewOpenAIProvider("bad-key", "text-embedding-3-small")
	p.SetBaseURL(srv.URL)
	if _, err := p.Embed(context.Background(), []string{"hello"}); err == nil {
		t.Fatal("expected error for 401 response")
	}
}
