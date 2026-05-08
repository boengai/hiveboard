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

# ── Stage 3: Bundle API into a single file ──
FROM deps AS build-api
COPY tsconfig.json ./
COPY packages/api/ packages/api/
RUN cd packages/api && bun run build

# ── Stage 4: Production image ──
FROM oven/bun:1 AS production
WORKDIR /app

# Minimal runtime — only what HiveBoard's server itself depends on:
#   - git + openssh-client + ca-certificates + curl: cloning task workspaces.
#   - gh: the post-exit pipeline calls `gh pr create` after IMPLEMENT/REVISE.
# The agent runtime (Claude CLI, Node.js, Python, build tooling, cloudflared,
# convenience CLIs like jq/ripgrep) is deliberately NOT baked in. Agents need
# whatever toolchain your workflows use — install it per the "Customizing the
# runtime" section in README.md (derived image, volume-persisted install, or
# entrypoint hook).
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl && \
    # GitHub CLI — orchestrator calls `gh pr create` after a successful run.
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user (Claude CLI refuses --dangerously-skip-permissions as root,
# so when users install Claude on top of this image they get the right account).
RUN groupadd -r hiveboard && useradd -r -g hiveboard -m -s /bin/bash hiveboard

COPY --from=build-api /app/packages/api/dist ./packages/api/dist
COPY packages/api/WORKFLOW.md packages/api/
COPY --from=build-web /app/packages/web/dist ./packages/web/dist

RUN mkdir -p tmp/workspaces tmp/database && chown -R hiveboard:hiveboard tmp

ENV NODE_ENV=production
ENV API_PORT=8080
EXPOSE 8080

USER hiveboard

CMD ["bun", "run", "packages/api/dist/index.js"]
