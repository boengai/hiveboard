# HiveBoard

HiveBoard is a board-driven orchestrator that watches a GitHub Projects V2 board for issues with `action:*` labels, creates isolated per-issue workspaces, and dispatches autonomous coding agents to complete the work.

Inspired by [OpenAI Symphony](https://github.com/openai/symphony) (harness engineering for [autonomous software agents](https://openai.com/index/harness-engineering/)) and [Stripe Minions](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents) (one-shot end-to-end coding agents at scale).

> [!WARNING]
> HiveBoard is an engineering preview for testing in trusted environments.

## How it works

1. You add `action:implement` + `repo:my-app` labels to a GitHub issue
2. A webhook (or polling fallback) picks up the issue
3. HiveBoard clones the target repo into an isolated workspace
4. Claude CLI runs against the issue with the prompt from `WORKFLOW.md`
5. On success the issue moves to "Review"; on failure it retries with backoff
6. Reviewer leaves PR comments → add `action:revise` to re-run focused on just those comments

Labels drive automation (`action:*`, `repo:*`, `status:*`), columns drive visual status (In Progress, Review, Done).

### Action labels

| Label                  | Purpose                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action:plan`          | Ask the agent to produce an implementation plan without writing code. Useful for scoping work, identifying affected files, and getting early feedback before committing to changes.                                                                                                                                                                       |
| `action:implement`     | The primary trigger. The agent clones the target repo, writes code to satisfy the issue requirements, creates a branch, commits, and opens a pull request. On success the issue moves to "Review" and receives `action:review`.                                                                                                                           |
| `action:implement-e2e` | Same as `action:implement` but signals the agent to include end-to-end tests alongside the implementation. Use this when the issue specifically requires E2E test coverage.                                                                                                                                                                               |
| `action:review`        | Automatically added after a successful `action:implement` run. Signals that the PR is ready for human review. Can also be added manually to ask the agent to self-review an existing PR and leave comments.                                                                                                                                               |
| `action:revise`        | Re-runs the agent on an existing PR after a reviewer leaves comments. Unlike other actions, `action:revise` fetches all `CHANGES_REQUESTED` and `COMMENTED` review comments from the linked PR, injects them into the prompt with file paths, line numbers, and diff context, and instructs the agent to make only targeted fixes — no unrelated changes. |

All action labels follow the same lifecycle: when dispatched, the `action:*` label is removed, `status:running` is added, and the issue moves to "In Progress". On success it moves to "Review"; on failure `status:failed` is added and the issue is retried with exponential backoff.

## Setup

### Prerequisites

- [Bun](https://bun.sh) (v1.1+)
- A GitHub Projects V2 board (org-level or repo-scoped)
- A GitHub personal access token with `project`, `repo`, and `issues` scopes
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

### Install

```bash
git clone https://github.com/boengai/hiveboard.git
cd hiveboard
make setup    # runs bun install
```

### Configure

1. Copy the example `.env` file and fill in your secrets:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
GITHUB_OWNER=your-org
GITHUB_PROJECT_NUMBER=5
GITHUB_TOKEN=ghp_your_token_here
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here
```

Bun loads `.env` automatically — no need to export variables manually.

HiveBoard also supports **GitHub App authentication** as an alternative to a personal access token. Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_INSTALLATION_ID` in `.env` instead of `GITHUB_TOKEN`. See `.env.example` for details.

HiveBoard auto-detects whether the owner is an organization or user account. Each issue must have a `repo:*` label to route to the correct target repository.

2. Edit `WORKFLOW.md` YAML front matter for your project (project number, workspace root, etc.).

Key config fields in the YAML front matter:

| Field                                   | Default          | Description                                               |
| --------------------------------------- | ---------------- | --------------------------------------------------------- |
| `tracker.kind`                          | `"github"`       | Tracker type (currently only `github`)                    |
| `tracker.owner`                         | —                | `$GITHUB_OWNER` (resolved from env)                       |
| `tracker.repo`                          | —                | Repository name (optional, only for repo-scoped projects) |
| `tracker.project_number`                | —                | `$GITHUB_PROJECT_NUMBER` (resolved from env)              |
| `tracker.labels.*`                      | see below        | Label prefixes for actions, repos, and statuses           |
| `tracker.columns.*`                     | see below        | Project board column names                                |
| `polling.interval_ms`                   | `30000`          | How often to poll for new issues (ms)                     |
| `workspace.root`                        | `"./workspaces"` | Directory for per-issue workspaces                        |
| `workspace.ttl_ms`                      | `259200000`      | Stale workspace TTL (default 72 hours, 0 = never)         |
| `claude.command`                        | `"claude"`       | Claude CLI binary name                                    |
| `claude.model`                          | —                | Claude model to use                                       |
| `claude.max_turns`                      | `50`             | Max agent turns per run                                   |
| `claude.allowed_tools`                  | —                | Restrict which tools agents can use                       |
| `claude.permission_mode`                | —                | Permission level for agents                               |
| `agent.max_concurrent_agents`           | `5`              | Concurrency limit                                         |
| `agent.max_retry_backoff_ms`            | `300000`         | Max retry backoff (default 5 min)                         |
| `hooks.after_create`                    | —                | Shell command to run after workspace creation             |
| `hooks.before_run`                      | —                | Shell command to run before agent starts                  |
| `hooks.after_run`                       | —                | Shell command to run after agent finishes                 |
| `hooks.before_remove`                   | —                | Shell command to run before workspace removal             |
| `hooks.timeout_ms`                      | `60000`          | Timeout for hook execution (ms)                           |
| `webhook.port`                          | `8080`           | Port for the webhook server                               |
| `webhook.host`                          | `"0.0.0.0"`      | Webhook server bind address                               |
| `webhook.secret`                        | —                | `$GITHUB_WEBHOOK_SECRET` (resolved from env)              |
| `worker.ssh_hosts`                      | `[]`             | SSH hosts for remote agent execution                      |
| `worker.max_concurrent_agents_per_host` | `5`              | Max agents per SSH host                                   |

**Label defaults** (`tracker.labels`):

| Field            | Default            |
| ---------------- | ------------------ |
| `action_prefix`  | `"action:"`        |
| `repo_prefix`    | `"repo:"`          |
| `status_prefix`  | `"status:"`        |
| `status_running` | `"status:running"` |
| `status_failed`  | `"status:failed"`  |

**Column defaults** (`tracker.columns`):

| Field         | Default         |
| ------------- | --------------- |
| `backlog`     | `"Backlog"`     |
| `todo`        | `"Todo"`        |
| `in_progress` | `"In Progress"` |
| `review`      | `"Review"`      |
| `done`        | `"Done"`        |

### Expose webhooks with Cloudflare Tunnel

HiveBoard needs a public URL so GitHub can deliver webhook events. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) is the recommended way to expose your local service without opening firewall ports.

#### 1. Install `cloudflared`

**macOS**

```bash
brew install cloudflared
```

**Linux**

```bash
# Debian / Ubuntu
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# RHEL / Fedora
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm -o cloudflared.rpm
sudo rpm -i cloudflared.rpm

# Arch
yay -S cloudflared
```

**Windows**

```powershell
# Using winget
winget install Cloudflare.cloudflared

# Or download the installer
# https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi
```

**WSL2**

```bash
# Install the Linux version inside WSL (not the Windows .msi)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
```

> [!TIP]
> WSL2 runs its own network namespace. Services on `localhost:8080` inside WSL are not the same as Windows `localhost:8080`. Always run both HiveBoard and `cloudflared` **inside the same WSL distro** so the tunnel can reach the server directly.

Verify installation:

```bash
cloudflared --version
```

#### 2. Quick tunnel (no Cloudflare account needed)

Start HiveBoard, then run:

```bash
cloudflared tunnel --url http://localhost:8080
```

`cloudflared` prints a public URL like `https://random-words.trycloudflare.com`. Use this as your webhook payload URL.

> [!NOTE]
> Quick tunnels generate a new random URL each time. This is fine for development but you'll need a named tunnel for production.

#### 3. Named tunnel (persistent URL, recommended for production)

```bash
# Authenticate with your Cloudflare account
cloudflared tunnel login

# Create a named tunnel
cloudflared tunnel create hiveboard

# Route your subdomain to the tunnel
cloudflared tunnel route dns hiveboard hiveboard-webhook.yourdomain.com

# Run the tunnel
cloudflared tunnel run --url http://localhost:8080 hiveboard
```

This gives you a stable URL like `https://hiveboard-webhook.yourdomain.com`.

#### 4. Run as a background service

**macOS**

```bash
sudo cloudflared service install
sudo launchctl start com.cloudflare.cloudflared
```

**Linux (systemd)**

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

**Windows**

```powershell
cloudflared service install
# Starts automatically as a Windows service
```

#### 5. Configure with a config file (optional)

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: hiveboard
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: hiveboard-webhook.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
```

Then just run:

```bash
cloudflared tunnel run
```

#### 6. Docker users

The Docker image includes `cloudflared`. Just set the env var in `.env` — HiveBoard manages the tunnel process automatically:

```bash
# Quick tunnel (free, random URL)
CLOUDFLARE_TUNNEL=true

# Or named tunnel (persistent URL)
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
```

No sidecar container needed — `docker compose up -d` handles everything.

### Set up GitHub webhook

1. Go to your repo **Settings > Webhooks > Add webhook**
2. Payload URL: your tunnel URL + `/webhook` (e.g. `https://hiveboard-webhook.yourdomain.com/webhook` or `https://random-words.trycloudflare.com/webhook`)
3. Content type: `application/json`
4. Secret: same value as `$GITHUB_WEBHOOK_SECRET`
5. Events: select **Issues** (labeled, unlabeled, closed)

Webhook is optional — HiveBoard also polls on a configurable interval (default 30s).

### Create labels

HiveBoard auto-creates missing labels when it first needs them, but you can pre-create them if you prefer:

- `action:plan`, `action:implement`, `action:review`, `action:revise`, `action:implement-e2e`
- `repo:<your-repo-name>` (e.g. `repo:my-app`)
- `status:running`, `status:failed`

### Set up project board columns

Your GitHub Projects V2 board needs columns matching the config. Defaults: "Backlog", "Todo", "In Progress", "Review", "Done". Unlike labels, columns cannot be auto-created — you must create them manually on the project board.

## Usage

### Start HiveBoard

```bash
bun run start               # production
bun run dev                 # with --watch for development
```

Or with a custom workflow file:

```bash
bun run src/index.ts path/to/WORKFLOW.md
```

### Docker

Build and run with Docker Compose:

```bash
docker compose up -d          # start
docker compose logs -f        # view logs
docker compose down           # stop
```

Or build the image directly:

```bash
# Production image
docker build --target production -t hiveboard .

# Run
docker run --env-file .env -p 8080:8080 -v ./WORKFLOW.md:/app/WORKFLOW.md:ro hiveboard
```

The webhook port can be changed via the `WEBHOOK_PORT` environment variable (defaults to `8080`).

> [!IMPORTANT]
> **Claude CLI is already installed in the image.** HiveBoard shells out to `claude` to run agents. You only need to authenticate — either set `ANTHROPIC_API_KEY` in `.env`, or mount your host config:
>
> ```bash
> docker run --env-file .env -p 8080:8080 \
>   -v ~/.claude:/root/.claude:ro \
>   -v ./WORKFLOW.md:/app/WORKFLOW.md:ro hiveboard
> ```

Health check is built in — Docker will automatically restart the container if `/health` stops responding.

### Trigger work

Add labels to a GitHub issue in your tracked project:

```
action:implement + repo:my-app
```

HiveBoard will:

1. Remove the `action:implement` label, add `status:running`
2. Move the issue to "In Progress" column
3. Create a workspace and run Claude CLI
4. On completion: move to "Review", add `action:review`
5. On failure: add `status:failed`, retry with exponential backoff

### Revise after review

When a reviewer leaves comments on the PR and wants the agent to address them:

```
action:revise + repo:my-app
```

Unlike `action:implement`, the `action:revise` flow:

1. Fetches the linked PR's review comments (from `CHANGES_REQUESTED` and `COMMENTED` reviews)
2. Injects them into the agent prompt with file paths, line numbers, and diff context
3. Instructs the agent to make only targeted fixes for each comment — no unrelated changes

### Health check

```bash
curl http://localhost:8080/health
# {"ok":true,"running":0,"completed":0,"pendingRetries":0}
```

### Stop

Send `SIGTERM` or `SIGINT` (Ctrl-C). HiveBoard waits for running agents to finish before exiting.

## Development

```bash
make setup      # install dependencies
make test       # run tests (bun test)
make fmt        # auto-fix formatting and lint (biome)
make lint       # lint only
make ci         # full CI: format check + lint + typecheck + tests
make build      # bundle to dist/
```

### Project structure

```
src/
  config/        # WORKFLOW.md loader + Zod schema
  github/        # GitHub Projects V2 GraphQL client
  labels/        # Repo label parsing (repo:* → owner/name)
  orchestrator/  # Core dispatch loop + state management
  workspace/     # Per-issue workspace creation/removal
  agent/         # Claude CLI runner + Mustache prompt rendering
  webhook/       # Bun HTTP server for GitHub webhooks
  tunnel/        # Cloudflare tunnel integration (quick + named)
  ssh/           # SSH remote worker support
  types/         # Shared type definitions
test/            # Tests (bun:test)
WORKFLOW.md      # Runtime config + prompt template
```

## Contributing

See the [Maintainer Guide](docs/maintainer-guide.md) for architecture details, how-to recipes (adding config fields, webhook events, swapping the agent runtime), testing conventions, and CI pipeline documentation.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
