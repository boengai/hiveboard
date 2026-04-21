import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import {
  insertVerificationRun,
  listFailingRunsForAgentRun,
  listVerificationRunsForTask,
} from '../src/db/verification-runs'

function setup(): Database {
  const db = new Database(':memory:')
  createTables(db)
  // Seed one user, board, column, task, agent_run to satisfy FKs.
  db.run(
    "INSERT INTO users (id, username, display_name) VALUES ('U1', 'u', 'U')",
  )
  db.run("INSERT INTO boards (id, name, created_by) VALUES ('B1', 'b', 'U1')")
  db.run(
    "INSERT INTO columns (id, board_id, name, position) VALUES ('C1', 'B1', 'Todo', 0)",
  )
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, created_by, updated_by)
     VALUES ('T1', 'B1', 'C1', 't', 'U1', 'U1')`,
  )
  db.run(
    `INSERT INTO agent_runs (id, task_id, action, status)
     VALUES ('R1', 'T1', 'implement', 'success')`,
  )
  return db
}

describe('verification_runs DB layer', () => {
  it('insertVerificationRun + listVerificationRunsForTask round trip', () => {
    const db = setup()
    const id = insertVerificationRun(db, {
      agentRunId: 'R1',
      command: 'bun run test',
      exitCode: 0,
      finishedAt: '2026-04-21T00:00:01.000Z',
      label: 'test',
      output: 'ok',
      startedAt: '2026-04-21T00:00:00.000Z',
      taskId: 'T1',
    })
    const rows = listVerificationRunsForTask(db, 'T1')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(id)
    expect(rows[0].label).toBe('test')
    expect(rows[0].exitCode).toBe(0)
    expect(rows[0].agentRunId).toBe('R1')
  })

  it('listVerificationRunsForTask returns newest first', () => {
    const db = setup()
    const first = insertVerificationRun(db, {
      agentRunId: 'R1',
      command: 'a',
      exitCode: 0,
      finishedAt: '2026-04-21T00:00:02.000Z',
      label: 'a',
      output: '',
      startedAt: '2026-04-21T00:00:01.000Z',
      taskId: 'T1',
    })
    const second = insertVerificationRun(db, {
      agentRunId: 'R1',
      command: 'b',
      exitCode: 0,
      finishedAt: '2026-04-21T00:00:04.000Z',
      label: 'b',
      output: '',
      startedAt: '2026-04-21T00:00:03.000Z',
      taskId: 'T1',
    })
    const rows = listVerificationRunsForTask(db, 'T1')
    expect(rows[0].id).toBe(second)
    expect(rows[1].id).toBe(first)
  })

  it('listFailingRunsForAgentRun returns only non-zero exit rows for given agent run', () => {
    const db = setup()
    insertVerificationRun(db, {
      agentRunId: 'R1',
      command: 'pass',
      exitCode: 0,
      finishedAt: '2026-04-21T00:00:02Z',
      label: 'lint',
      output: '',
      startedAt: '2026-04-21T00:00:01Z',
      taskId: 'T1',
    })
    insertVerificationRun(db, {
      agentRunId: 'R1',
      command: 'fail',
      exitCode: 1,
      finishedAt: '2026-04-21T00:00:04Z',
      label: 'test',
      output: 'oops',
      startedAt: '2026-04-21T00:00:03Z',
      taskId: 'T1',
    })
    const rows = listFailingRunsForAgentRun(db, 'R1')
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('test')
    expect(rows[0].exitCode).toBe(1)
  })
})
