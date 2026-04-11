import { join } from 'node:path'
import type { TaskForAgent } from './runner'

/**
 * Env vars that must NEVER be passed to the agent subprocess.
 * The agent does not need direct GitHub/Git credentials — workspace hooks
 * already embed tokens in git remote URLs via hookEnv().
 */
const DENIED_ENV_VARS = new Set([
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_INSTALLATION_ID',
])

/**
 * Env vars allowed to be inherited from the host process.
 * Only these will be forwarded to the agent subprocess.
 */
const ALLOWED_ENV_VARS = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TERM',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'NODE_ENV',
  'NO_COLOR',
])

/** Build a safe env for the agent subprocess using an allowlist approach. */
export function buildAgentEnv(
  task: TaskForAgent,
  workspacePath: string,
  gitIdentity?: { name: string; email: string },
  tokenDir?: string,
): Record<string, string> {
  const env: Record<string, string> = {}

  // Copy allowed vars from host env
  for (const key of ALLOWED_ENV_VARS) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }

  // Double-check: remove any denied vars (defense in depth)
  for (const key of DENIED_ENV_VARS) {
    delete env[key]
  }

  // Add task-specific vars
  env.HIVEBOARD_TASK_ID = task.id
  env.HIVEBOARD_TASK_TITLE = task.title
  env.HIVEBOARD_WORKSPACE = workspacePath

  // Add git identity if provided
  if (gitIdentity) {
    env.GIT_AUTHOR_EMAIL = gitIdentity.email
    env.GIT_AUTHOR_NAME = gitIdentity.name
    env.GIT_COMMITTER_EMAIL = gitIdentity.email
    env.GIT_COMMITTER_NAME = gitIdentity.name
  }

  // When a tokenDir is provided, point git & gh at on-disk token files that
  // the orchestrator keeps up-to-date across refreshes.
  if (tokenDir) {
    env.GH_CONFIG_DIR = join(tokenDir, 'gh')
    env.GIT_ASKPASS = join(tokenDir, 'askpass.sh')
    env.HIVEBOARD_TOKEN_FILE = join(tokenDir, 'token')
  }

  return env
}
