.PHONY: help setup build fmt fmt-check lint test ci \
       docker-up docker-down docker-logs docker-build docker-clean

help:
	@echo "Targets: setup, build, fmt, fmt-check, lint, test, ci"
	@echo "Docker:  docker-build, docker-up, docker-down, docker-logs, docker-clean"

setup:
	bun install

build:
	bun build src/index.ts --target bun --outdir dist

fmt:
	bunx biome check --fix .

fmt-check:
	bunx biome check .

lint:
	bunx biome lint .

test:
	bun test

ci:
	$(MAKE) setup
	$(MAKE) fmt-check
	$(MAKE) lint
	bun run tsc
	$(MAKE) test

# ── Docker ──────────────────────────────────────────────────────
docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-clean:
	docker compose down --rmi all --volumes --remove-orphans
