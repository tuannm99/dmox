package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

func apiBaseURL() string {
	if v := os.Getenv("DMOX_API_URL"); v != "" {
		return v
	}
	return "http://localhost:8080"
}

func apiGet(path string, out any) error {
	resp, err := http.Get(apiBaseURL() + path)
	if err != nil {
		return fmt.Errorf("dmox: cannot reach dmox server at %s (is `dmox serve` running?): %w", apiBaseURL(), err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("dmox: api error %d: %s", resp.StatusCode, string(b))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
