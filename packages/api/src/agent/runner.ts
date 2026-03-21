import { consola } from 'consola'
import type { Config } from '../config/schema'
import { renderPrompt } from './prompt'

export type TaskForAgent = {
  id: string
  title: string
  body: string
  action: string | null
  targetRepo: string | null
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
  retryAttempt?: number
  reviewComments?: string
  signal?: AbortSignal
  onLog?: (chunk: string) => void
}

/** Build Claude CLI arguments from config. */
function buildClaudeArgs(config: Config, prompt: string): string[] {
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

  if (config.claude.allowed_tools?.length) {
    args.push('--allowedTools', config.claude.allowed_tools.join(','))
  }

  if (config.claude.permission_mode) {
    args.push('--permission-mode', config.claude.permission_mode)
  }

  args.push(prompt)

  return args
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
  } = options

  const prompt = renderPrompt(
    promptTemplate,
    task,
    retryAttempt && retryAttempt > 0 ? retryAttempt : undefined,
    reviewComments,
  )

  const args = buildClaudeArgs(config, prompt)

  consola.info(
    `Starting Claude CLI for task ${task.id} (action: ${task.action})`,
  )

  const proc = Bun.spawn(args, {
    cwd: workspacePath,
    env: {
      ...process.env,
      HIVEBOARD_TASK_ID: task.id,
      HIVEBOARD_TASK_TITLE: task.title,
      HIVEBOARD_WORKSPACE: workspacePath,
    },
    stdout: 'pipe',
    stderr: 'pipe',
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
    readChunks()
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
      taskId: task.id,
      success: false,
      output,
      error: stderr || `Exit code ${exitCode}`,
    }
  }

  consola.info(`Claude CLI completed for task ${task.id}`)
  return {
    taskId: task.id,
    success: true,
    output,
  }
}
