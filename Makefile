.PHONY: dev dev-api dev-web build start test lint fmt

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
