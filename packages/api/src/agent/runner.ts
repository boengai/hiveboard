import type { Database } from 'bun:sqlite'
import { consola } from 'consola'
import type { Config } from '../config/schema'
import { insertCheckpoint } from '../db/checkpoints'
import { generateId } from '../db/ulid'
import { publishCheckpointAdded } from '../pubsub'
import { scrubSecrets, type SecretPair } from '../secrets/scrubber'
import { readScratchpad } from '../workspace/agent-state'
import { checkpointsSupported } from './capability'
import { buildAgentEnv } from './env'
import { NDJSONLineParser } from './ndjson-line-parser'
import {
  type RunAgentMessage,
  renderPrompt,
  type VerificationFailureForPrompt,
} from './prompt'
import { type Checkpoint, summarizeEvent } from './summarize'

export type { RunAgentMessage }

export type TaskForAgent = {
  id: string
  title: string
  body: string
  action: string | null
  agentInstruction: string | null
  targetRepo: string | null
  targetBranch: string | null
  prUrl: string | null
}

export type AgentResult = {
  taskId: string
  success: boolean
  output: string
  error?: string
}

export type PreviousAttemptReplay = {
  failure_summary: string
  turn_count: number
  checkpoints: Array<{ turn: number; kind: string; summary: string }>
}

export type RunAgentOptions = {
  task: TaskForAgent
  workspacePath: string
  promptTemplate: string
  config: Config
  db: Database
  retryAttempt?: number
  reviewComments?: string
  signal?: AbortSignal
  onLog?: (chunk: string) => void
  gitIdentity?: { name: string; email: string }
  /** Directory containing token files for dynamic credential refresh. */
  tokenDir?: string
  /**
   * Freshly minted installation token. Set as `GITHUB_TOKEN`/`GH_TOKEN` in
   * the agent env so default-path auth works without the agent having to
   * discover the askpass setup.
   */
  accessToken?: string
  messages?: RunAgentMessage[]
  verificationFailures?: VerificationFailureForPrompt[]
  allowedToolsOverride?: string[] | null
  /** When set, agent_run_checkpoints rows are inserted under this id. */
  agentRunId?: string
  previousAttemptReplay?: PreviousAttemptReplay
  /** Decrypted secret values to inject into the subprocess env, bypassing ALLOWED_ENV_VARS. */
  secretsEnv?: Record<string, string>
  /** Flat list of plaintext values to scrub from the final AgentResult.output / .error. */
  secretValues?: string[]
  /** Names and optional descriptions of required secrets, for prompt context. */
  requiredSecrets?: Array<{ name: string; description?: string | null }>
}

/** Build the list of SecretPairs to scrub from agent output. */
export function buildScrubPairs(
  secretsEnv?: Record<string, string>,
  secretValues?: string[],
): SecretPair[] {
  const pairs: SecretPair[] = []
  const seenValues = new Set<string>()
  if (secretsEnv) {
    for (const [name, value] of Object.entries(secretsEnv)) {
      if (value && !seenValues.has(value)) {
        pairs.push({ name, value })
        seenValues.add(value)
      }
    }
  }
  for (const v of secretValues ?? []) {
    if (v && !seenValues.has(v)) {
      pairs.push({ name: 'REDACTED', value: v })
      seenValues.add(v)
    }
  }
  return pairs
}

/** Build Claude CLI arguments from config. */
function buildClaudeArgs(
  config: Config,
  prompt: string,
  allowedToolsOverride?: string[] | null,
): string[] {
  const args: string[] = [
    config.claude.command,
    '--print',
    '--output-format',
    checkpointsSupported() ? 'stream-json' : 'json',
  ]

  if (checkpointsSupported()) {
    args.push('--verbose')
  }

  if (config.claude.model) {
    args.push('--model', config.claude.model)
  }

  args.push('--max-turns', String(config.claude.max_turns))

  const allowedTools =
    allowedToolsOverride && allowedToolsOverride.length > 0
      ? allowedToolsOverride
      : config.claude.allowed_tools
  if (allowedTools?.length) {
    args.push('--allowedTools', allowedTools.join(','))
  }

  if (config.claude.permission_mode) {
    args.push('--permission-mode', config.claude.permission_mode)
  }

  args.push(prompt)
  return args
}

/** Test-only export (kept internal in prod code). */
export function buildClaudeArgsForTest(
  config: Config,
  prompt: string,
  allowedToolsOverride?: string[] | null,
): string[] {
  return buildClaudeArgs(config, prompt, allowedToolsOverride)
}

/** Run Claude CLI for a task (local only). */
export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const {
    task,
    workspacePath,
    promptTemplate,
    config,
    retryAttempt,
    reviewComments,
    signal,
    onLog,
    gitIdentity,
    tokenDir,
    accessToken,
    messages,
    verificationFailures,
  } = options

  const scratchpad = await readScratchpad(config, task.id)

  const prompt = renderPrompt(
    promptTemplate,
    task,
    retryAttempt && retryAttempt > 0 ? retryAttempt : undefined,
    reviewComments,
    scratchpad,
    messages,
    verificationFailures && verificationFailures.length > 0
      ? { verification_failures: verificationFailures }
      : undefined,
    options.previousAttemptReplay,
    { db: options.db },
    options.requiredSecrets,
  )

  const args = buildClaudeArgs(config, prompt, options.allowedToolsOverride)

  consola.info(
    `Starting Claude CLI for task ${task.id} (action: ${task.action})`,
  )

  const baseEnv = buildAgentEnv(
    task,
    workspacePath,
    gitIdentity,
    tokenDir,
    config,
    accessToken,
  )
  const env = { ...baseEnv, ...(options.secretsEnv ?? {}) }

  const proc = Bun.spawn(args, {
    cwd: workspacePath,
    env,
    stderr: 'pipe',
    stdout: 'pipe',
  })

  // Handle abort signal
  if (signal) {
    signal.addEventListener('abort', () => {
      consola.warn(`Aborting Claude CLI for task ${task.id}`)
      proc.kill()
    })
  }

  let output = ''
  let turn = 0
  const agentRunId = options.agentRunId
  const captureCheckpoints = Boolean(checkpointsSupported() && agentRunId)
  const db = options.db

  const workspaceRoot = options.workspacePath
  const lineParser = captureCheckpoints
    ? new NDJSONLineParser(
        (evt, meta) => {
          // Narrow for TS — captureCheckpoints already implies agentRunId
          // is set, but the closure can't see that across const boundaries.
          if (!agentRunId) return
          turn += 1
          const cp: Checkpoint | null = summarizeEvent(evt, turn, {
            rawBytes: meta.rawBytes,
            workspaceRoot,
          })
          if (!cp) return
          const id = generateId()
          try {
            insertCheckpoint(db, {
              agentRunId,
              id,
              kind: cp.kind,
              rawBytes: cp.rawBytes,
              summary: cp.summary,
              turn: cp.turn,
            })
            publishCheckpointAdded(task.id, {
              agentRunId,
              id,
              kind: cp.kind,
              occurredAt: new Date().toISOString(),
              rawBytes: cp.rawBytes,
              summary: cp.summary,
              taskId: task.id,
              turn: cp.turn,
            })
          } catch (err) {
            consola.warn(
              `checkpoint write for ${agentRunId} turn ${turn}: ${(err as Error).message}`,
            )
          }
        },
        {
          onParseError: (err, line) => {
            consola.warn(
              `stream-json parse error: ${err.message} | line=${line.slice(0, 120)}`,
            )
          },
        },
      )
    : null

  if (proc.stdout) {
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        output += chunk
        // NOTE: live-stream chunks (onLog) are NOT scrubbed — only the final
        // AgentResult.output/.error are scrubbed before return. Subscribers may
        // briefly see raw secret values in flight. Live-stream scrubbing is
        // deferred to a follow-up; see Plan H "Out of Scope" section.
        onLog?.(chunk)
        lineParser?.feed(chunk)
      }
    } catch {
      // Stream closed.
    }
    lineParser?.flush()
  }

  const exitCode = await proc.exited

  const stderr = await new Response(proc.stderr as ReadableStream).text()

  const scrubPairs = buildScrubPairs(options.secretsEnv, options.secretValues)

  if (exitCode !== 0) {
    consola.error(
      `Claude CLI failed for task ${task.id} (exit ${exitCode}): ${stderr.slice(0, 200)}`,
    )
    return {
      error: scrubSecrets(stderr || `Exit code ${exitCode}`, scrubPairs),
      output: scrubSecrets(output, scrubPairs),
      success: false,
      taskId: task.id,
    }
  }

  consola.info(`Claude CLI completed for task ${task.id}`)
  return {
    output: scrubSecrets(output, scrubPairs),
    success: true,
    taskId: task.id,
  }
}
