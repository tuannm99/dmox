package main

import (
	"context"
	"log"
	"net/http"

	"github.com/tuannm99/dmox/internal/api"
	"github.com/tuannm99/dmox/internal/app"
	"github.com/tuannm99/dmox/internal/config"
	"github.com/tuannm99/dmox/internal/livesync"
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
		oldBody, hadOld, err := a.Store.GetFileBody(ctx, wsID, src.ID(), ev.Path)
		if err != nil {
			log.Printf("watch %s/%s/%s: read previous content failed: %v", wsID, src.ID(), ev.Path, err)
		}

		if err := a.Indexer.IndexFile(ctx, wsID, src, ev.Path); err != nil {
			log.Printf("reindex %s/%s/%s failed: %v", wsID, src.ID(), ev.Path, err)
			continue
		}

		if ev.Op != source.ChangeOpDelete {
			newBody, ok, err := a.Store.GetFileBody(ctx, wsID, src.ID(), ev.Path)
			if err != nil {
				log.Printf("watch %s/%s/%s: read new content failed: %v", wsID, src.ID(), ev.Path, err)
			} else if ok {
				base := ""
				if hadOld {
					base = oldBody
				}
				a.Diffs.Record(wsID, src.ID(), ev.Path, base, newBody)
			}
		}

		a.Events.Publish(wsID, livesync.Event{SourceID: src.ID(), Path: ev.Path, Op: changeOpString(ev.Op)})
	}
}

func changeOpString(op source.ChangeOp) string {
	switch op {
	case source.ChangeOpCreate:
		return "create"
	case source.ChangeOpDelete:
		return "delete"
	default:
		return "modify"
	}
}
