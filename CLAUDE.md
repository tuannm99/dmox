# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DMOX is a read-only, local-first, Git-backed documentation browser with
search, Git history and live reload as files change on disk, distributed as a
single Go binary. Full design doc:
`docs/superpowers/specs/2026-07-17-dmox-core-platform-design.md`. Business
roadmap (self-host-per-company, not multi-tenant): `docs/roadmap/`.

## Commands

Backend requires CGO + the `sqlite_fts5` build tag — plain `go build`/`go
test` without these will fail or silently misbehave:

```
CGO_ENABLED=1 go build -tags sqlite_fts5 -o bin/dmox ./cmd/dmox
CGO_ENABLED=1 go test -tags sqlite_fts5 ./...
CGO_ENABLED=1 go test -tags sqlite_fts5 ./internal/search/...          # one package
CGO_ENABLED=1 go test -tags sqlite_fts5 -run TestName ./internal/api/  # one test
```

Frontend (`web/`, Vite + React + TypeScript):

```
cd web && npm run dev            # dev server against a separately-running `dmox serve` on :8080
cd web && npm test                # vitest
cd web && npx vitest run src/path/to/File.test.tsx   # one file
cd web && npx vitest run -t "test name"              # one test
cd web && npm run test:e2e        # Playwright, needs a running dmox serve/build output
```

Open `http://localhost:5173/__DMOX_BASE__/` in dev mode, not the bare root —
`__DMOX_BASE__` is a base-path placeholder substituted at build/static-export
time, and it's required in dev too or routing breaks.

Makefile wraps the two-language build (always run `build-frontend` before a
Go build/test, or `internal/webassets/dist` will still hold the placeholder
and frontend-embedding tests will fail):

```
make build-frontend   # npm build, then copies web/dist -> internal/webassets/dist
make build            # build-frontend + go build
make test             # build-frontend + go test ./... + vitest run
make run              # build + ./bin/dmox serve
make docker-build     # docker build -t tuannm99/dmox:local .
```

`internal/webassets/dist/*` is gitignored except `index.html`, which is
tracked only as an "unbuilt" placeholder — running any build target
overwrites it locally with real SPA output; that diff is expected and should
not be committed.

Go formatting: `gofmt -l .` must report nothing before committing (no
separate linter configured).

## Architecture

DMOX ships two ways off the same codebase — this split shapes almost
everything in `internal/`:

- **`dmox serve`**: long-running Gin server exposing a REST API under
  `/api`, backed by a local SQLite index (FTS5 + optional vector search),
  with the built frontend embedded in the binary via `//go:embed`.
- **`dmox build --workspace ID --out DIR`**: static-export mode
  (`internal/staticbuild`) that reuses the same `app.App` (sync sources ->
  index -> build doc tree) but instead of serving requests, writes each
  file's rendered view, the search index, AI-context list, and git history
  to flat JSON under `data/`, copies the SPA bundle, and stamps a static
  `index.html` per route.

Package map:

```
cmd/dmox/            CLI entrypoints: serve, build, tree, context (client.go is a
                      shared HTTP-client helper used by tree/context against DMOX_API_URL)
internal/
  config/            YAML config parsing (workspaces, sources, embeddings, PlantUML, keymap)
  app/                App/Workspace wiring: builds Store, Indexer, Search, Git, PlantUML
                      renderer from config; owns sync+index lifecycle
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
  terminal/           PTY-backed shell sessions streamed over WebSocket — no auth (see below)
  api/                Gin router: workspace/tree/file/search/git/terminal/keymap handlers,
                      plus MountFrontend() serving the embedded SPA with SPA fallback
  webassets/          //go:embed of internal/webassets/dist (see build note above)
  staticbuild/        Implements `dmox build` (see above)
web/                  React + TypeScript SPA (Vite, React Router v6)
```

Frontend has two datasource implementations behind one interface
(`web/src/datasource/{liveDataSource,staticDataSource}.ts`) so the same UI
runs against either the live REST API (`dmox serve`) or the static JSON a
`dmox build` export produces — any new data-fetching UI needs both
implemented, not just the live one.

**Right-side panel model** (`WorkspaceLayout.tsx` + `RightPanel.tsx`):
Terminal/Search/AI Context are not routes, they're a single toggleable,
resizable dock panel — only one active at a time, lazy-mounted on first open
and then kept mounted (`hidden` attribute, never unmounted) so e.g. the
Terminal's WebSocket/PTY session survives switching away and back. Default
keybindings are VSCode-style, overridable per-instance via `config.yaml`'s
`keymap:` map (served at `GET /api/keymap`, merged client-side in
`web/src/keymap.ts`); the toggle binding is read through a ref inside
`TerminalPanel`'s xterm setup effect specifically so changing the keymap
doesn't retrigger the WebSocket connection.

**Terminal has no authentication.** `GET /api/workspaces/:id/terminal/ws`
runs an arbitrary interactive shell rooted at the workspace's source
directory. This is only safe because `dmox serve` is meant for localhost,
single-user use — never expose it on a LAN/tunnel/reverse-proxy without
adding auth in front first. This constraint drives real design decisions
(e.g. Docker image binds to `127.0.0.1` by convention, not `0.0.0.0`; the
business roadmap's Sprint 2 explicitly gates Terminal behind a feature flag
+ permission check before any multi-user deployment).

**Git working-tree status is expensive and often inapplicable.**
`gitsvc.WorkingTree()` uses go-git's `Status()`, which hashes the whole
working tree — measured at ~2s on a mid-sized repo. It is cached per
directory and invalidated from `watchAndReindex` (`cmd/dmox/serve.go`) when
the file watcher reports a change, with a 10s TTL as the backstop for what
the watcher can't see (a `git checkout` happens inside `.git`). Don't call it
per-request without that cache. Separately, it only means anything for a
`LocalSource` sitting inside a real checkout: a `GitSource` is a mirrored
clone with no working tree, and a `docs/` directory mounted into Docker
without its surrounding repo has no `.git` to find. Both report
`applicable: false` — an ordinary state the UI hides, not an error.

**Keep react-markdown's `components` map referentially stable**
(`MarkdownView.tsx`). React compares element types by reference, so building
that map inline per render hands react-markdown new component types every
time and remounts the entire document. That isn't just wasted work: it
re-runs `MermaidBlock`'s async render, so the diagram is empty for a frame,
`.content`'s `scrollHeight` collapses by the diagram's full height, and the
browser clamps `scrollTop` — any re-render then throws the reader back to the
top of a diagram-heavy page. There's a regression test for this in
`MarkdownView.test.tsx`. The same reasoning applies to any render-prop or
callback map handed to a component that keys off identity.

Global CSS note: `web/src/styles.css` sets `box-sizing: border-box` on `*`
globally — required, because `height:100%` + `padding` on the same element
(`.content`, `.sidebar`) overflows its allotted space by exactly its padding
under the browser default `content-box`, with nothing to clip it before it
reaches the root `overflow:hidden` and silently cuts off the last line of
content. Don't remove this reset.
