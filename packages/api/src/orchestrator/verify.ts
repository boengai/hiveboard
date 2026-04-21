import type { Database } from 'bun:sqlite'
import { consola } from 'consola'
import type { Config, VerifyCommand } from '../config/schema'
import { insertVerificationRun } from '../db/verification-runs'
import { publishVerificationRun } from '../pubsub'
import { appendScratchpadEntry } from '../workspace/agent-state'
import { escapeMustacheSyntax } from './mustache-escape'

export type VerificationRunRecord = {
  command: string
  label: string
  exit_code: number
  output: string
  started_at: string
  finished_at: string
}

const MAX_OUTPUT_LINES = 200

function tailLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return lines.slice(lines.length - maxLines).join('\n')
}

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('HIVEBOARD_')) continue
    env[k] = v
  }
  return env
}

/**
 * Run a single verification command inside `cwd`. Captures stdout+stderr,
 * truncates to the last 200 lines, hard-kills on timeout (exit_code=-1),
 * and strips HIVEBOARD_* env vars so verification doesn't see agent I/O.
 */
export async function runVerificationCommand(
  cmd: VerifyCommand,
  cwd: string,
): Promise<VerificationRunRecord> {
  const started = new Date().toISOString()
  // `sh -c` (not `-lc`): predictable behavior across macOS/Linux; login-shell
  // dotfiles add latency and non-determinism. PATH and other env vars are
  // already inherited via sanitizedEnv().
  const proc = Bun.spawn(['sh', '-c', cmd.run], {
    cwd,
    env: sanitizedEnv(),
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      proc.kill('SIGKILL')
    } catch {
      /* already exited */
    }
  }, cmd.timeout_ms)

  const [stdout, stderr, rawExit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)

  const combined = `${stdout}${stderr}`
  const finished = new Date().toISOString()
  const exit_code = timedOut ? -1 : rawExit

  return {
    command: cmd.run,
    exit_code,
    finished_at: finished,
    label: cmd.label,
    output: tailLines(combined, MAX_OUTPUT_LINES),
    started_at: started,
  }
}

export type VerificationFailureContext = {
  verification_failures: Array<{
    label: string
    command: string
    exit_code: number
    output: string
  }>
}

export function formatVerificationFailureForAgent(
  failures: VerificationRunRecord[],
): VerificationFailureContext {
  return {
    verification_failures: failures.map((f) => ({
      command: escapeMustacheSyntax(f.command),
      exit_code: f.exit_code,
      label: escapeMustacheSyntax(f.label),
      output: escapeMustacheSyntax(f.output),
    })),
  }
}

// ---------------------------------------------------------------------------
// verifyAndGate
// ---------------------------------------------------------------------------

export type VerifyVerdict = 'pass' | 'fail'

function resolveCommands(
  config: Config,
  db: Database,
  taskId: string,
): VerifyCommand[] {
  const row = db
    .query('SELECT verify_commands FROM tasks WHERE id = ?')
    .get(taskId) as { verify_commands: string | null } | null
  if (row?.verify_commands) {
    try {
      const parsed = JSON.parse(row.verify_commands) as Array<{
        label: string
        run: string
        timeout_ms?: number
      }>
      return parsed.map((c) => ({
        label: c.label,
        run: c.run,
        timeout_ms: c.timeout_ms ?? 300_000,
      }))
    } catch (err) {
      consola.warn(
        `Invalid verify_commands JSON on task ${taskId}; falling back to defaults: ${(err as Error).message}`,
      )
    }
  }
  return config.verify.commands
}

function formatScratchpadSummary(
  records: Array<{
    label: string
    exit_code: number
    started_at: string
    finished_at: string
  }>,
): string {
  const stamp = new Date().toISOString()
  const lines = records.map((r) => {
    const status = r.exit_code === 0 ? 'pass' : `FAIL (exit ${r.exit_code})`
    const elapsedMs =
      new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()
    const secs = (elapsedMs / 1000).toFixed(1)
    return `- ${r.label}: ${status} (${secs}s)`
  })
  return `## ${stamp} — VERIFY\n${lines.join('\n')}`
}

/**
 * Run each configured verification command sequentially inside the workspace.
 * Writes a verification_runs row per command, publishes pubsub events, and
 * appends a summary to the task's scratchpad. Returns 'pass' if all exit 0,
 * 'fail' if any non-zero.
 *
 * Short-circuits to 'pass' with no side effects when verify.enabled is false
 * or the resolved command list is empty.
 */
export async function verifyAndGate(params: {
  taskId: string
  agentRunId: string
  config: Config
  db: Database
  workspacePath: string
}): Promise<VerifyVerdict> {
  const { taskId, agentRunId, config, db, workspacePath } = params

  if (!config.verify.enabled) return 'pass'

  const commands = resolveCommands(config, db, taskId)
  if (commands.length === 0) return 'pass'

  const records: Array<VerificationRunRecord & { id: string }> = []
  let allPassed = true

  for (const cmd of commands) {
    const rec = await runVerificationCommand(cmd, workspacePath)
    const id = insertVerificationRun(db, {
      agentRunId,
      command: rec.command,
      exitCode: rec.exit_code,
      finishedAt: rec.finished_at,
      label: rec.label,
      output: rec.output,
      startedAt: rec.started_at,
      taskId,
    })
    publishVerificationRun(taskId, {
      agentRunId,
      command: rec.command,
      exitCode: rec.exit_code,
      finishedAt: rec.finished_at,
      id,
      label: rec.label,
      output: rec.output,
      startedAt: rec.started_at,
      taskId,
    })
    records.push({ ...rec, id })
    if (rec.exit_code !== 0) allPassed = false
  }

  await appendScratchpadEntry(config, taskId, formatScratchpadSummary(records))

  return allPassed ? 'pass' : 'fail'
}
