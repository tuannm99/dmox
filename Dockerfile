# syntax=docker/dockerfile:1

# --- Stage 1: frontend build -------------------------------------------------
FROM node:22.14-bookworm-slim AS frontend
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: Go build -------------------------------------------------------
# Same Debian base/glibc as the final stage so the cgo sqlite3 binding built
# here is guaranteed ABI-compatible with what it runs against below.
FROM golang:1.26-bookworm AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY --from=frontend /src/web/dist/. internal/webassets/dist/
RUN CGO_ENABLED=1 go build -tags sqlite_fts5 -trimpath -ldflags="-s -w" -o /out/dmox ./cmd/dmox

# --- Stage 3: runtime ---------------------------------------------------------
# Debian slim, not distroless/scratch: the Terminal panel feature spawns a
# real interactive shell rooted at the mounted docs directory, which needs an
# actual shell + coreutils + git to be usable at all.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Run as an unprivileged, dedicated user rather than root. This matters more
# than usual for dmox: `dmox serve`'s Terminal panel is an intentional,
# no-auth remote-shell surface (see README) — if this container is ever
# reachable beyond localhost (misconfigured port mapping, an exposed
# ingress), whoever reaches it gets a shell as whatever user the process
# runs as. Running as root here would turn a documented local-only risk into
# a host-level one the moment the network boundary slips.
RUN groupadd --gid 10001 dmox && \
    useradd --uid 10001 --gid dmox --home-dir /app --shell /bin/bash --create-home dmox

WORKDIR /app
COPY --from=builder --chown=dmox:dmox /out/dmox /app/dmox

# Workspace config and doc sources are user/project-specific — never baked
# into the image. Mount them at runtime:
#   docker run \
#     -v $(pwd)/config.yaml:/app/config.yaml:ro \
#     -v $(pwd)/docs:/app/docs \
#     -v dmox-data:/data \
#     -p 127.0.0.1:8080:8080 \
#     dmox
# Binding to 127.0.0.1 on the host (not 0.0.0.0) keeps the no-auth Terminal
# endpoint off the network, matching how `dmox serve` is meant to run.
#
# Point data_dir at the persistent volume above so the SQLite index and any
# git-source mirrors survive a container restart, e.g. in config.yaml:
#   data_dir: /data
RUN mkdir -p /data && chown dmox:dmox /data
VOLUME ["/data"]

USER dmox
EXPOSE 8080
ENTRYPOINT ["/app/dmox"]
CMD ["serve"]
