package main

import (
	"context"
	"flag"
	"fmt"
	"log"

	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/staticbuild"
)

func runBuildCmd(args []string) {
	fs := flag.NewFlagSet("build", flag.ExitOnError)
	workspace := fs.String("workspace", "", "workspace id")
	out := fs.String("out", "./dist", "output directory")
	basePath := fs.String("base-path", "/", "base path for deployment, e.g. /repo-name/")
	fs.Parse(args)
	if *workspace == "" {
		log.Fatal("dmox build: --workspace is required")
	}
	cfg := mustLoadConfig()
	a, err := app.New(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer a.Close()

	err = staticbuild.Build(context.Background(), a, staticbuild.Options{
		WorkspaceID: *workspace, OutDir: *out, BasePath: *basePath,
	})
	if err != nil {
		log.Fatalf("dmox build failed: %v", err)
	}
	fmt.Printf("dmox build: wrote static export to %s\n", *out)
}
