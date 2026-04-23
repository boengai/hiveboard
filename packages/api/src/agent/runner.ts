import type { Database } from 'bun:sqlite'
import { consola } from 'consola'
import type { Config } from '../config/schema'
import { readScratchpad } from '../workspace/agent-state'
import { buildAgentEnv } from './env'
import {
  type RunAgentMessage,
  renderPrompt,
  type VerificationFailureForPrompt,
} from './prompt'

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
  messages?: RunAgentMessage[]
  verificationFailures?: VerificationFailureForPrompt[]
  allowedToolsOverride?: string[] | null
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
    'json',
  ]

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
    { db: options.db },
  )

  const args = buildClaudeArgs(config, prompt, options.allowedToolsOverride)

  consola.info(
    `Starting Claude CLI for task ${task.id} (action: ${task.action})`,
  )

  const proc = Bun.spawn(args, {
    cwd: workspacePath,
    env: buildAgentEnv(task, workspacePath, gitIdentity, tokenDir, config),
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

  // Stream stdout chunks to onLog callback while accumulating full output
  let output = ''

  if (onLog && proc.stdout) {
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    const readChunks = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          output += chunk
          onLog(chunk)
        }
      } catch {
        // Stream closed
      }
    }
    await readChunks()
  }

  const exitCode = await proc.exited

  // If no onLog, read stdout the simple way
  if (!onLog) {
    output = await new Response(proc.stdout as ReadableStream).text()
  }

  const stderr = await new Response(proc.stderr as ReadableStream).text()

  if (exitCode !== 0) {
    consola.error(
      `Claude CLI failed for task ${task.id} (exit ${exitCode}): ${stderr.slice(0, 200)}`,
    )
    return {
      error: stderr || `Exit code ${exitCode}`,
      output,
      success: false,
      taskId: task.id,
    }
  }

  consola.info(`Claude CLI completed for task ${task.id}`)
  return {
    output,
    success: true,
    taskId: task.id,
  }
}
