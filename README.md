# DMOX

A read-only, local-first, Git-backed documentation browser with search, Git
history and live reload as files change on disk, distributed as a single Go
binary. See
`docs/superpowers/specs/2026-07-17-dmox-core-platform-design.md` for the full
design.

## Architecture

DMOX ships two ways off the same codebase:

- **`dmox serve`** — a long-running Go server exposing a REST API, backed by
  a local SQLite index (FTS5 + optional vector search), with the built
  frontend embedded in the binary.
- **`dmox build`** — a static-export mode that pre-renders the same data to
  flat JSON + an SPA shell, for hosting without a running Go process.

```
cmd/dmox/            CLI entrypoints: serve, build, tree, context, client
internal/
  config/            YAML config parsing (workspaces, sources, embeddings, PlantUML)
  app/                App/Workspace wiring: constructs Store, Indexer, Search, Git,
                      PlantUML renderer from config; owns sync+index lifecycle
  source/             Source abstraction — local/ (filesystem) and git/ (mirrored clone)
  doctree/            Builds the navigable doc tree from a workspace's sources
  index/              Parses docs (frontmatter, AI-context detection), feeds the indexer
  store/              SQLite persistence layer
  search/             Full-text (FTS5) + optional vector search over the store
  embedprovider/      Embedding provider abstraction (OpenAI implementation)
  render/             Markdown rendering helpers, PlantUML-to-image rendering (cached)
  gitsvc/             Two different git reads: history/blame against a GitSource's
                      mirrored clone, and branch/status/working-diff against the
                      checkout a LocalSource sits in (see the caching note below)
  livesync/           Per-workspace change pub/sub (Hub) feeding the SSE stream, plus
                      a DiffCache holding before/after content for on-demand diffs
  terminal/           PTY-backed shell sessions streamed over WebSocket
  api/                Gin HTTP router: workspace/tree/file/search/git/terminal handlers,
                      plus MountFrontend() which serves the embedded SPA with SPA fallback
  webassets/          //go:embed of the built frontend (internal/webassets/dist) so the
                      Go binary is self-contained — see below
  staticbuild/        Implements `dmox build`: walks the doc tree, writes JSON snapshots
                      per file plus search/AI-context/git-history JSON, copies the SPA
                      assets, and stamps out a static index.html per route
web/                  React + TypeScript SPA (Vite). Two datasource implementations
                      (datasource/liveDataSource.ts, datasource/staticDataSource.ts)
                      let the same UI run against either the live REST API or the
                      static JSON produced by `dmox build`
```

Request flow for `dmox serve`: `cmd/dmox/serve.go` builds an `app.App` from
config, mounts `internal/api`'s router (REST endpoints under `/api`, plus
`MountFrontend` for everything else), and the frontend's `liveDataSource`
talks to those endpoints at runtime.

Request flow for `dmox build`: `internal/staticbuild` reuses the same `app.App`
(sync sources → index → build doc tree) but instead of serving requests, it
writes each file's rendered view, the search index, AI-context list, and git
history to flat JSON under `data/`, copies the SPA bundle, and generates a
static `index.html` per route so the exported directory is servable by any
static file host. The frontend's `staticDataSource` reads that JSON instead
of calling `/api/*`.

**Why `internal/webassets/dist` exists:** Go's `//go:embed` can only embed
files that live under the importing package's own directory, so the frontend
build output (`web/dist`, produced by `cd web && npm run build`) is copied
into `internal/webassets/dist` as a build step (see `Makefile`) before
`go build` embeds it via `//go:embed all:dist` in `internal/webassets/webassets.go`.
That's what lets `dmox serve` ship as a single self-contained binary with no
`web/` or Node.js needed at runtime.

## Local development

Backend + frontend against the live API (two terminals):

    CGO_ENABLED=1 go build -tags sqlite_fts5 -o bin/dmox ./cmd/dmox
    ./bin/dmox serve          # serves the REST API on :8080 against ./example/docs

    cd web && npm install && npm run dev   # Vite dev server, talks to :8080

Open http://localhost:5173/__DMOX_BASE__/ (not the bare root — the base-path
placeholder used for static-export subpath hosting applies in dev mode too).

Full binary with the embedded frontend:

    make build
    ./bin/dmox serve

Static export:

    make build
    ./bin/dmox build --workspace example --out ./dist --base-path /

## In-browser terminal

Each workspace has a `Terminal` tab (top nav) that opens a real shell rooted
at the workspace's local source directory, streamed over a WebSocket
(`GET /api/workspaces/:id/terminal/ws`). It runs whatever command you type —
including `claude` — with no authentication layer.

This is safe only because `dmox serve` is meant to run on localhost for a
single user. Do not put this server on a LAN, behind a tunnel, or behind a
reverse proxy without adding authentication in front of it first, or anyone
who can reach the port can run commands on your machine.

## Docker

    docker build -t dmox .
    docker run \
      -v $(pwd)/config.yaml:/app/config.yaml:ro \
      -v $(pwd)/docs:/app/docs \
      -v dmox-data:/data \
      -p 127.0.0.1:8080:8080 \
      dmox

`config.yaml` and your doc sources are never baked into the image — they're
project-specific, so they're mounted at runtime. Point `data_dir: /data` in
your mounted `config.yaml` so the SQLite index and any git-source mirrors
persist across container restarts via the `dmox-data` volume.

### Serving docs from several repos with one mount

A relative local-source path in `config.yaml` (`path: ../podzone/docs`)
resolves against the process working dir — the repo root under `make run`, but
`WORKDIR /app` inside the container. That mismatch used to force a hand-written
bind mount per repo, each at a container path chosen to match how its relative
path resolved.

`workspace_root` removes that: relative local-source paths resolve against it
instead of the working dir. The `DMOX_WORKSPACE_ROOT` env var overrides the
file value, so **one `config.yaml` works unchanged on the host and in the
container**:

```yaml
# config.yaml
workspace_root: ..            # host: repos live one level up (../podzone, ...)
workspaces:
  - id: podzone
    sources: [{ id: local, type: local, path: podzone/docs }]
```

```bash
make dev        # writes .env (DMOX_ROOT=<parent of this repo>), then compose up
```

`make dev` + `docker-compose.override.example.yml` (copy it to
`docker-compose.override.yml`) mount that parent dir **once** at `/workspaces`
and set `DMOX_WORKSPACE_ROOT=/workspaces`, so every relative path resolves
under the single mount. On the host, `DMOX_WORKSPACE_ROOT` is unset and the
same paths resolve against `workspace_root: ..`. Absolute source paths, and any
path when no root is configured, are left exactly as before.

The image runs as a dedicated non-root user, and the final stage is
`debian:bookworm-slim` (not distroless/scratch) because the Terminal
panel needs an actual shell to spawn — `git` and `ca-certificates` are the
only extras installed. PlantUML rendering is left disabled by default (no
JRE bundled, ~150-200MB smaller); extend the Dockerfile yourself if you need
it.

**Bind to `127.0.0.1` on the host, not `0.0.0.0`.** The security note in
[In-browser terminal](#in-browser-terminal) applies at least as much in a
container: whoever can reach the port gets an unauthenticated shell as the
container's user. A container boundary doesn't add auth — don't publish
this port on a LAN, behind a tunnel, or behind an ingress without adding
authentication in front of it first.

## Tests

    make test

Playwright smoke tests are run manually against a running `dmox serve` or
`dmox build` output — see Task 24 of the implementation plan for exact
commands.
