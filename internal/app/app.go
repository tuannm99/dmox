package app

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/tuannm99/dmox/internal/config"
	"github.com/tuannm99/dmox/internal/embedprovider"
	"github.com/tuannm99/dmox/internal/gitsvc"
	"github.com/tuannm99/dmox/internal/index"
	"github.com/tuannm99/dmox/internal/render"
	"github.com/tuannm99/dmox/internal/search"
	"github.com/tuannm99/dmox/internal/source"
	"github.com/tuannm99/dmox/internal/store"
)

type Workspace struct {
	Cfg     config.Workspace
	Sources map[string]source.Source
}

func (w *Workspace) SourceIDs() []string {
	ids := make([]string, len(w.Cfg.Sources))
	for i, s := range w.Cfg.Sources {
		ids[i] = s.ID
	}
	return ids
}

type App struct {
	Cfg        *config.Config
	Store      *store.Store
	Indexer    *index.Indexer
	Search     *search.Service
	Git        *gitsvc.Service
	PlantUML   *render.PlantUMLRenderer
	Workspaces map[string]*Workspace
}

func New(cfg *config.Config) (*App, error) {
	dbPath := filepath.Join(cfg.DataDir, "dmox.db")
	st, err := store.Open(dbPath)
	if err != nil {
		return nil, err
	}

	a := &App{
		Cfg:        cfg,
		Store:      st,
		Indexer:    index.New(st),
		Search:     search.New(st),
		Git:        gitsvc.New(),
		PlantUML:   render.NewPlantUMLRenderer(cfg.Render.PlantUML.JarPath, filepath.Join(cfg.DataDir, "plantuml-cache")),
		Workspaces: map[string]*Workspace{},
	}

	for _, wcfg := range cfg.Workspaces {
		ws := &Workspace{Cfg: wcfg, Sources: map[string]source.Source{}}
		for _, scfg := range wcfg.Sources {
			switch scfg.Type {
			case "local":
				ws.Sources[scfg.ID] = source.NewLocalSource(scfg.ID, scfg.Path)
			case "git":
				ws.Sources[scfg.ID] = source.NewGitSource(scfg.ID, scfg.URL, scfg.Branch, cfg.DataDir)
			default:
				st.Close()
				return nil, fmt.Errorf("workspace %s source %s: unknown type %q", wcfg.ID, scfg.ID, scfg.Type)
			}
		}
		a.Workspaces[wcfg.ID] = ws
	}

	if cfg.Embeddings.Provider == "openai" {
		vs := search.NewVectorStore(st)
		if err := vs.EnsureSchema(context.Background()); err != nil {
			st.Close()
			return nil, err
		}
		provider := embedprovider.NewOpenAIProvider(os.Getenv(cfg.Embeddings.APIKeyEnv), cfg.Embeddings.Model)
		a.Search.SetVectorSearch(vs, provider)
	}

	return a, nil
}

func (a *App) Workspace(id string) (*Workspace, bool) {
	ws, ok := a.Workspaces[id]
	return ws, ok
}

// SyncAndIndexAll syncs and indexes every source in every workspace. When
// failFast is true (dmox build), the first error aborts; when false (dmox
// serve startup), errors are logged and the source keeps its last-known-good
// index (spec §5).
func (a *App) SyncAndIndexAll(ctx context.Context, failFast bool) error {
	for wsID, ws := range a.Workspaces {
		for _, src := range ws.Sources {
			if err := src.Sync(ctx); err != nil {
				if failFast {
					return fmt.Errorf("sync %s/%s: %w", wsID, src.ID(), err)
				}
				log.Printf("sync %s/%s failed, using last-known-good index: %v", wsID, src.ID(), err)
				continue
			}
			if err := a.Indexer.IndexSource(ctx, wsID, src); err != nil {
				if failFast {
					return fmt.Errorf("index %s/%s: %w", wsID, src.ID(), err)
				}
				log.Printf("index %s/%s failed: %v", wsID, src.ID(), err)
			}
		}
	}
	return nil
}

func (a *App) Close() error { return a.Store.Close() }
