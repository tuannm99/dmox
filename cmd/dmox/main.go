package main

import (
	"fmt"
	"log"
	"os"

	"github.com/tuannm99/dmox/internal/config"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}
	switch os.Args[1] {
	case "serve":
		cfg := mustLoadConfig()
		if err := runServe(cfg); err != nil {
			log.Fatal(err)
		}
	case "build":
		runBuildCmd(os.Args[2:])
	case "tree":
		runTreeCmd(os.Args[2:])
	case "context":
		runContextCmd(os.Args[2:])
	default:
		printUsage()
		os.Exit(1)
	}
}

func mustLoadConfig() *config.Config {
	path := os.Getenv("DMOX_CONFIG")
	if path == "" {
		path = "config.yaml"
	}
	cfg, err := config.Load(path)
	if err != nil {
		log.Fatalf("dmox: %v", err)
	}
	return cfg
}

func printUsage() {
	fmt.Fprintln(os.Stderr, `dmox - Engineering Knowledge Platform

Usage:
  dmox serve                              Start the local server (web UI + REST API)
  dmox build --workspace ID --out DIR     Produce a static export
  dmox tree --workspace ID [--format text|json]
  dmox context --workspace ID [--filter ai|all]`)
}
