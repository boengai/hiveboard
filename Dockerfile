# ---- base ----
FROM oven/bun:1 AS base
WORKDIR /app

# ---- install ----
FROM base AS install
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# ---- build ----
FROM base AS build
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY tsconfig.json WORKFLOW.md ./
RUN bun build src/index.ts --target bun --outdir dist

# ---- production ----
FROM base AS production

# HiveBoard is a harness — agents run arbitrary dev workflows inside workspaces.
# Install a full dev toolchain so agents can build, test, and deploy without
# hitting missing-tool errors mid-run.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      # Core
      git openssh-client ca-certificates curl wget \
      # Build toolchain
      build-essential cmake pkg-config \
      # Python
      python3 python3-pip python3-venv python3-dev \
      # System libs commonly needed by native modules
      libssl-dev libffi-dev zlib1g-dev libyaml-dev \
      # CLI utilities agents commonly invoke
      jq unzip zip tar gzip xz-utils \
      ripgrep fd-find tree less \
      # Process & network debugging
      procps net-tools dnsutils && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js LTS (agents may need npm/npx for non-bun projects)
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# GitHub CLI — agents use `gh pr create` to open pull requests
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

# Required: Claude CLI — HiveBoard shells out to `claude` to run agents
# Use npm (not bun) so the binary lands in /usr/local/bin/ accessible to all users
RUN npm install -g @anthropic-ai/claude-code

# Required: cloudflared — webhook tunnel (quick trycloudflare or named tunnels)
ARG TARGETARCH=amd64
RUN curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${TARGETARCH}" -o /usr/local/bin/cloudflared && \
    chmod +x /usr/local/bin/cloudflared

# Common global tools agents may need
RUN npm install -g pnpm yarn tsx typescript


# Create non-root user (Claude CLI refuses --dangerously-skip-permissions as root)
RUN groupadd -r hiveboard && useradd -r -g hiveboard -m -s /bin/bash hiveboard

COPY --from=install /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/WORKFLOW.md ./

RUN mkdir -p workspaces && chown hiveboard:hiveboard workspaces

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

USER hiveboard

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "dist/index.js"]
