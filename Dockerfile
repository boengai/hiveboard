# ── Stage 1: Install deps ──
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile

# ── Stage 2: Build web assets ──
FROM deps AS build-web
COPY package.json ./
COPY packages/web/ packages/web/
RUN bun run --filter web build

# ── Stage 3: Production image ──
FROM oven/bun:1 AS production
WORKDIR /app

RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY packages/api/ packages/api/
COPY --from=build-web /app/packages/web/dist ./packages/web/dist
COPY WORKFLOW.md ./

RUN useradd -m hiveboard
USER hiveboard

ENV NODE_ENV=production
ENV API_PORT=8080
EXPOSE 8080

CMD ["bun", "run", "packages/api/src/index.ts"]
