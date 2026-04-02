# ── Stage 1: Install deps ──
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile

# ── Stage 2: Build web assets ──
FROM deps AS build-web
COPY tsconfig.json ./
COPY packages/web/ packages/web/
RUN cd packages/web && bun run build

# ── Stage 3: Production image ──
FROM oven/bun:1 AS production
WORKDIR /app

# HiveBoard is a harness — agents run arbitrary dev workflows inside workspaces.
# Install a runtime toolchain so agents can build, test, and deploy.
# Dev headers (-dev packages) are omitted to save ~200MB; agents can install
# them per-workspace if a native addon needs compiling.
ARG TARGETARCH=amd64
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      # Core
      git openssh-client ca-certificates curl wget \
      # Build toolchain (no cmake — rarely needed, agents can install if needed)
      build-essential pkg-config \
      # Python (runtime only, no -dev headers)
      python3 python3-pip python3-venv \
      # CLI utilities agents commonly invoke
      jq unzip zip tar gzip xz-utils \
      ripgrep fd-find tree less \
      procps && \
    # Node.js LTS (agents may need npm/npx for non-bun projects)
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y nodejs && \
    # GitHub CLI — agents use `gh pr create` to open pull requests
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/* && \
    # Claude CLI — HiveBoard shells out to `claude` to run agents
    npm install -g @anthropic-ai/claude-code tsx typescript && \
    npm cache clean --force && \
    # cloudflared — webhook tunnel (quick trycloudflare or named tunnels)
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${TARGETARCH}" \
      -o /usr/local/bin/cloudflared && \
    chmod +x /usr/local/bin/cloudflared

# Create non-root user (Claude CLI refuses --dangerously-skip-permissions as root)
RUN groupadd -r hiveboard && useradd -r -g hiveboard -m -s /bin/bash hiveboard

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY packages/api/ packages/api/
COPY --from=build-web /app/packages/web/dist ./packages/web/dist

RUN mkdir -p tmp/workspaces && chown hiveboard:hiveboard tmp/workspaces

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
ENV API_PORT=8080
EXPOSE 8080

USER hiveboard

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "packages/api/src/index.ts"]
