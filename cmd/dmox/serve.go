package main

import (
	"context"
	"log"
	"net/http"

	"github.com/tuannm99/dmox/internal/api"
	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/config"
	"github.com/tuannm99/dmox/internal/source"
)

func runServe(cfg *config.Config) error {
	a, err := app.New(cfg)
	if err != nil {
		return err
	}
	defer a.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := a.SyncAndIndexAll(ctx, false); err != nil {
		log.Printf("startup sync had errors: %v", err)
	}

	for wsID, ws := range a.Workspaces {
		for _, src := range ws.Sources {
			events, err := src.Watch(ctx)
			if err != nil {
				log.Printf("watch %s/%s failed: %v", wsID, src.ID(), err)
				continue
			}
			if events == nil {
				continue
			}
			go watchAndReindex(ctx, a, wsID, src, events)
		}
	}

	router := api.NewRouter(a)
	if err := mountFrontend(router); err != nil {
		log.Printf("frontend assets unavailable, API-only mode: %v", err)
	}
	srv := &http.Server{Addr: cfg.Server.Addr, Handler: router}
	log.Printf("dmox serving on %s", cfg.Server.Addr)
	return srv.ListenAndServe()
}

func watchAndReindex(ctx context.Context, a *app.App, wsID string, src source.Source, events <-chan source.ChangeEvent) {
	for ev := range events {
		if err := a.Indexer.IndexFile(ctx, wsID, src, ev.Path); err != nil {
			log.Printf("reindex %s/%s/%s failed: %v", wsID, src.ID(), ev.Path, err)
		}
	}
}
