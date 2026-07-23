.PHONY: build-frontend build test run docker-build docker-up docker-down dev

build-frontend:
	cd web && npm ci && npm run build
	rm -rf internal/webassets/dist
	mkdir -p internal/webassets/dist
	cp -r web/dist/. internal/webassets/dist/

build: build-frontend
	CGO_ENABLED=1 go build -tags sqlite_fts5 -o bin/dmox ./cmd/dmox

test: build-frontend
	CGO_ENABLED=1 go test -tags sqlite_fts5 ./...
	cd web && npx vitest run

run: build
	./bin/dmox serve

docker-build:
	docker build -t tuannm99/dmox:local .

# DEV-ONLY: Compose auto-merges docker-compose.override.yml on top of
# docker-compose.yml here, which bind-mounts this host's node/npm/claude
# binaries and ~/.claude config into the Terminal panel's shell. Only works
# on a machine with those paths (see the override file's comments); never
# use this target's image/config for anything beyond local dev.
docker-up:
	docker compose up --build

docker-down:
	docker compose down -v

# Single-mount dev stack: write a .env pointing DMOX_ROOT at the parent of
# this checkout (the dir holding your sibling repos) unless one exists, then
# bring the stack up. Pair with docker-compose.override.example.yml copied to
# docker-compose.override.yml and relative source paths in config.yaml — see
# the README's "Docker" section.
dev:
	@test -f .env || { printf 'DMOX_ROOT=%s\n' "$$(cd .. && pwd)" > .env; echo "wrote .env: DMOX_ROOT=$$(cd .. && pwd)"; }
	docker compose up --build
