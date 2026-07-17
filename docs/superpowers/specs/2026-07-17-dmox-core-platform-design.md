# DMOX — Core Knowledge Platform (v0) Design

Status: Draft for review
Date: 2026-07-17
Sub-project: 1 of N (see "Deferred / Future Sub-Projects" below for the rest of the DMOX roadmap)

## 1. Problem & Scope

DMOX is an Engineering Knowledge Platform for humans and AI agents, with Git as
the source of truth. The full vision (multi-workspace, search, AI-assisted
authoring, Git write-back, a local agent, MCP integration, plugins, enterprise
auth) is too large for one design. This document scopes **only the first
sub-project**: a read-only, local-first, Git-backed documentation browser with
search and Git history, distributed as a single Go binary.

**Goal:** prove out the core browsing/rendering/search experience and the
Git-first data model before adding any write-paths, AI authoring features, or
multi-user concerns.

### In scope (v0)
- Multiple workspaces, each aggregating multiple sources (Git repos and/or
  local folders) into one browsable tree
- Markdown rendering, including Mermaid (client-side) and PlantUML
  (locally-rendered, no network calls)
- Full-text search (SQLite FTS5) and semantic search (pluggable, opt-in
  embeddings provider)
- Read-only Git integration: file history, blame
- An "AI Context" view that surfaces agent-facing files (`CLAUDE.md`,
  `AGENTS.md`, `.cursorrules`, etc.) distinctly in the UI
- A CLI (`dmox tree`, `dmox context`) that lets terminal coding agents
  (Codex, Claude Code, etc.) consume the same doc tree/content a human sees
  in the web UI, via the same REST API
- A static export (`dmox build`) that produces a self-contained static site
  deployable to GitHub Pages or any static host — browse, render, client-side
  full-text search, and Git history/blame, all frozen at build time (no
  semantic search, no live updates; see §3 and §4)

### Explicitly out of scope (v0)
- In-app editing, commits, or PRs from DMOX
- AI-assisted rewrite/review/translate/summarize
- The local agent (filesystem/terminal/AI-capable background process)
- MCP server integration
- Plugin/extension system
- Enterprise: auth, permissions, audit log, SSO
- Real-time multi-user collaboration

## 2. Architecture

Single Go binary (`dmox`), internally split into a REST API and core service
layer so it can later run as a shared team server without a rewrite — but
shipped and run as a local-first tool for v0.

```
┌───────────────────────────────────────────────┐
│  dmox (single Go binary)                       │
│                                                 │
│  ┌─────────────┐      ┌────────────────────┐   │
│  │  Gin router  │◄────►│ Vite/React SPA    │   │
│  │  (REST API)  │      │ (embedded static  │   │
│  │              │      │  assets via embed)│   │
│  └──────┬───────┘      └────────────────────┘   │
│         ▲                                       │
│  `dmox tree`/`dmox context` CLI (HTTP client    │
│   of the same local API — same interface the    │
│   web UI uses, requires `dmox serve` running)    │
│         │                                       │
│  ┌──────▼────────────────────────────────┐      │
│  │  Core services                        │      │
│  │   - Workspace/Config manager          │      │
│  │   - Source adapters (Git, Local dir)  │      │
│  │   - Indexer (FTS + embeddings)        │      │
│  │   - Search (full-text + semantic)     │      │
│  │   - Git service (history/blame)       │      │
│  │   - Render pipeline (MD/Mermaid/PUML) │      │
│  └──────┬─────────────────────────────────┘      │
│         │                                       │
│  ┌──────▼───────┐   ┌─────────────────────┐     │
│  │  SQLite       │   │ Local git mirrors   │     │
│  │ (metadata,    │   │ (bare/working clones│     │
│  │  FTS5, vector)│   │  under ~/.dmox/)    │     │
│  └───────────────┘   └─────────────────────┘     │
└───────────────────────────────────────────────┘
        │ (opt-in, per source)         │
        ▼                              ▼
 External embeddings API        Local PlantUML renderer
 (Voyage/OpenAI/Anthropic,      (separate local process,
  configurable per source)       no network calls)
```

Config lives in a single `config.yaml` (workspaces, sources, embeddings
provider, rendering options). No database server and no Node runtime required
at run time — Node is only needed to build the frontend bundle that gets
embedded into the binary.

**Two run modes, one SPA.** The Vite/React SPA's data-fetching layer talks to
a "data source" that is either the live Gin API (`dmox serve`) or a directory
of pre-generated static JSON files with the identical response shape
(`dmox build`). The SPA components never know which one they're talking to.
This avoids building a second rendering pipeline for static export — `dmox
build` runs the same core services once, dumps their outputs as static JSON
next to the SPA's static assets, and both modes render through the same
React components.

```
dmox build --workspace X --out ./dist [--base-path /repo-name/]
   │
   ├─ runs Source Adapters, Indexer, Git Service, Render Pipeline once
   │  (no server started, no live watching)
   │
   └─ writes:
        dist/
          index.html, assets/...        (SPA build, static-mode data source)
          data/tree.json
          data/files/<path>.json        (content + frontmatter + metadata)
          data/search-index.json        (client-side FTS, e.g. Pagefind-style)
          data/git-history.json         (log + blame, frozen at build time)
          data/ai-context.json
          <every-doc-route>/index.html  (SPA shell duplicated per route, so
                                          deep links work without a server-
                                          side rewrite rule)
```

Duplicating the SPA shell (`index.html`) into every doc route's folder is a
standard static-SPA-hosting trick: it lets GitHub Pages (or any static host)
serve a working page directly on a deep link/refresh, without needing a
custom 404 rewrite. The SPA's client-side router then takes over for
in-app navigation.

## 3. Core Components

| Component | Responsibility |
|---|---|
| **Config/Workspace Manager** | Loads `config.yaml`; exposes workspaces → sources; validates on load; hot-reloads on config file change |
| **Source Adapters** | Common `Source` interface (`Sync()`, `List()`, `Read(path)`); implementations: `GitSource` (mirror clone under `~/.dmox/`, fetch + hard-reset to remote tracking branch on pull — DMOX never writes, so there's no merge/conflict handling to build), `LocalSource` (fsnotify watch, live reindex) |
| **Indexer** | Walks synced sources, parses Markdown (frontmatter + body), writes to SQLite FTS5; if embeddings are enabled for that source, chunks + embeds + writes to `sqlite-vec`; flags files matching configurable AI-context filename conventions |
| **Search Service** | Runs FTS5 query and (if available) vector similarity query, merges/ranks, returns results with snippets |
| **Git Service** | Read-only: log/history per file, blame — wraps `go-git` against the local mirror |
| **Render Pipeline** | Markdown parsed to structured data (headings, frontmatter) for the client; Mermaid fenced blocks passed through as-is for client-side rendering; PlantUML fenced blocks sent to a local renderer process, with results cached alongside the source doc |
| **Gin API layer** | REST endpoints consumed by both the SPA and the CLI — the single interface every client (web, CLI, future MCP) goes through |
| **Static Site Builder** | `dmox build` entry point: runs Source Adapters, Indexer, Git Service, and Render Pipeline once (no server, no live watching), then serializes their outputs to the static JSON shapes above and copies the SPA build (configured for the static data source) into the output directory |

Each core component is an interface-first Go package (`source`, `index`,
`search`, `gitsvc`, `render`), independently testable, with the
multi-source-tree-merge logic living in the API layer rather than leaking
into any individual component.

## 4. Data Flow

1. **Startup** — `dmox serve` reads `config.yaml` → opens/creates the SQLite
   DB (default `~/.dmox/dmox.db`) → for each source: `LocalSource` starts an
   fsnotify watcher and does an initial full scan+index; `GitSource` clones
   (if absent) or fetches+hard-resets (if present), then indexes.
2. **Local file change** — fsnotify event → debounced (~300ms) → affected
   file re-parsed → FTS5 row updated, re-embedded if applicable, AI-context
   flag re-evaluated.
3. **Git pull** — triggered via `POST /api/sources/:id/pull` (UI button; no
   CLI command for this in v0) → `GitSource.Sync()` fetches and hard-resets
   to the remote's default branch → diffs the file list against the previous
   indexed state → re-indexes changed/added files, removes deleted ones.
4. **Browse** — client calls `GET /api/workspaces/:id/tree` → merged tree
   across all sources (each source is a mount point in the tree) → selecting
   a file calls `GET /api/workspaces/:id/file?path=...` → returns raw
   Markdown + frontmatter + AI-context flag + last-commit metadata → rendered
   client-side (Markdown, Mermaid) or via the cached PlantUML render.
5. **Search** — `GET /api/workspaces/:id/search?q=...` always runs the FTS5
   query; if embeddings are configured for the relevant source(s), also runs
   a vector similarity query; results are merged/ranked and returned with
   snippets and source/path.
6. **AI Context** — `GET /api/workspaces/:id/ai-context` lists files matching
   AI-context conventions across all sources; the UI's "copy as context"
   button concatenates fetched file contents client-side.
7. **Git history** — `GET /api/workspaces/:id/git/history?path=...` and
   `.../git/blame?path=...`; for `LocalSource`-backed files these return an
   empty/not-applicable result rather than an error.
8. **CLI** — `dmox tree --workspace X [--format text|json]` calls the tree
   endpoint and prints it; `dmox context --workspace X [--filter ai|all]`
   calls the AI-context (or full file) endpoint and prints concatenated
   content to stdout, meant for piping into a terminal coding agent. Both
   require `dmox serve` to be running — the CLI is a client, not a
   standalone offline tool.
9. **Static build** — `dmox build --workspace X --out DIR [--base-path P]`
   does a one-shot sync of every source in the workspace (same code path as
   startup sync, no watcher, no server), runs indexing and Git history/blame
   collection once, renders PlantUML diagrams to cached images, then writes
   the static JSON data files and the per-route SPA shells described in §2.
   The command exits when the build finishes; there's no long-running
   process and no `~/.dmox` state is required to already exist (a fresh
   temp/mirror clone is used if needed).

## 5. Error Handling

- **Source sync failure** (Git auth error, missing folder): the source is
  marked in an error state with a message; the rest of the workspace keeps
  functioning off the last-known-good index. The UI shows an error badge;
  the CLI still works against the cached index.
- **Embeddings API failure/timeout**: semantic search is skipped for that
  query, full-text results are still returned, the error is logged (not
  surfaced as a hard failure).
- **PlantUML render failure** (renderer missing/misconfigured): the diagram
  block renders as raw source with an inline "PlantUML rendering
  unavailable: `<reason>`" notice; the rest of the page still renders.
- **Malformed frontmatter/Markdown**: best-effort parse; the file is still
  indexed with raw content; parse warnings are logged.
- **Invalid config on startup**: fail fast with a clear error message rather
  than starting with a broken/partial config.
- **`dmox build` on a source with sync/render errors**: the build fails fast
  with a non-zero exit and a clear message (unlike `dmox serve`'s
  degrade-gracefully behavior) — a static export with silently missing pages
  is worse than a failed CI build, since there's no live UI to show an error
  badge on.

## 6. Testing Strategy

- **Go unit tests** per package (`source`, `index`, `search`, `gitsvc`,
  `render`), table-driven, using temp directories and local bare Git repos
  (via `go-git`) as fixtures — no network access required.
- **Integration tests**: run the Gin server in-process (`httptest`) and
  exercise API endpoints end to end against fixture workspaces.
- **Frontend**: component tests (Vitest + React Testing Library) for the
  tree view, Markdown/Mermaid renderer, and search results; a small
  Playwright smoke test covering the browse → search happy path.
- **CLI**: tests that invoke `dmox tree`/`dmox context` against a test
  server and assert on stdout format (text and JSON).
- **Static build**: an integration test runs `dmox build` against a fixture
  workspace, then asserts on the output directory — required files exist,
  `data/*.json` matches the live API's response schema for the same
  fixture, and a headless-browser smoke test loads a deep-linked doc route
  directly from the built output (no server) to confirm the per-route shell
  works.

## 7. Deferred / Future Sub-Projects

Each of these gets its own brainstorm → spec → plan cycle once v0 is real:

1. **MCP server integration** — the natural next step after this sub-project,
   since the CLI/API groundwork here (one REST interface for all clients)
   is what an MCP server would sit on top of.
2. **In-app editing + Git write-back** (commits, PRs)
3. **AI-assisted authoring** (review, rewrite, summarize, translate,
   knowledge discovery)
4. **Local agent** (filesystem/Git/terminal/AI-capable local process)
5. **Plugin/extension system**
6. **Enterprise features** (auth, permissions, audit logs, SSO)
