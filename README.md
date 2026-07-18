# DMOX

A read-only, local-first, Git-backed documentation browser with search and
Git history, distributed as a single Go binary. See
`docs/superpowers/specs/2026-07-17-dmox-core-platform-design.md` for the full
design.

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

## Tests

    make test

Playwright smoke tests are run manually against a running `dmox serve` or
`dmox build` output — see Task 24 of the implementation plan for exact
commands.
