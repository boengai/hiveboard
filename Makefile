.PHONY: dev dev-api dev-web build start test lint fmt \
       docker-build docker-up docker-down docker-logs docker-clean

dev:
	bun run dev

dev-api:
	bun run dev:api

dev-web:
	bun run dev:web

build:
	bun run build:web

start:
	bun run start

test:
	bun test

lint:
	bunx biome lint .

fmt:
	bunx biome check --fix .

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
