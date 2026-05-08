import type { Database } from 'bun:sqlite'
import { generateId } from './index'

export type VerificationRunRow = {
  id: string
  taskId: string
  agentRunId: string | null
  command: string
  label: string
  exitCode: number
  output: string
  startedAt: string
  finishedAt: string
}

type DbRow = {
  id: string
  task_id: string
  agent_run_id: string | null
  command: string
  label: string
  exit_code: number
  output: string
  started_at: string
  finished_at: string
}

function mapVerificationRunRow(r: DbRow): VerificationRunRow {
  return {
    agentRunId: r.agent_run_id,
    command: r.command,
    exitCode: r.exit_code,
    finishedAt: r.finished_at,
    id: r.id,
    label: r.label,
    output: r.output,
    startedAt: r.started_at,
    taskId: r.task_id,
  }
}

export function insertVerificationRun(
  db: Database,
  input: {
    taskId: string
    agentRunId: string | null
    command: string
    label: string
    exitCode: number
    output: string
    startedAt: string
    finishedAt: string
  },
): string {
  const id = generateId()
  db.run(
    `INSERT INTO verification_runs
       (id, task_id, agent_run_id, command, label, exit_code, output, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.taskId,
      input.agentRunId,
      input.command,
      input.label,
      input.exitCode,
      input.output,
      input.startedAt,
      input.finishedAt,
    ],
  )
  return id
}

export function listVerificationRunsForTask(
  db: Database,
  taskId: string,
): VerificationRunRow[] {
  const rows = db
    .query(
      `SELECT * FROM verification_runs
       WHERE task_id = ?
       ORDER BY started_at DESC`,
    )
    .all(taskId) as DbRow[]
  return rows.map(mapVerificationRunRow)
}

export function listFailingRunsForAgentRun(
  db: Database,
  agentRunId: string,
): VerificationRunRow[] {
  const rows = db
    .query(
      `SELECT * FROM verification_runs
       WHERE agent_run_id = ? AND exit_code != 0
       ORDER BY started_at ASC`,
    )
    .all(agentRunId) as DbRow[]
  return rows.map(mapVerificationRunRow)
}
