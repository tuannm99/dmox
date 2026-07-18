.PHONY: build-frontend build test run

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
