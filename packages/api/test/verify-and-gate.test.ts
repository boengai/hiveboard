import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '../src/config/schema'
import { createTables } from '../src/db/schema'
import { listVerificationRunsForTask } from '../src/db/verification-runs'
import { verifyAndGate } from '../src/orchestrator/verify'

let tempRoot: string
let wsRoot: string

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'hb-vag-state-'))
  wsRoot = mkdtempSync(join(tmpdir(), 'hb-vag-ws-'))
})

afterEach(() => {
  rmSync(tempRoot, { force: true, recursive: true })
  rmSync(wsRoot, { force: true, recursive: true })
})

function seedDb(): Database {
  const db = new Database(':memory:')
  createTables(db)
  db.run("INSERT INTO users (id, username, display_name) VALUES ('U1','u','U')")
  db.run("INSERT INTO boards (id, name, created_by) VALUES ('B1','b','U1')")
  db.run(
    "INSERT INTO columns (id, board_id, name, position) VALUES ('C1','B1','Todo',0)",
  )
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, created_by, updated_by)
     VALUES ('01HYX3KPQR000000000000000A', 'B1', 'C1', 't', 'U1', 'U1')`,
  )
  db.run(
    `INSERT INTO agent_runs (id, task_id, action, status)
     VALUES ('RUN1', '01HYX3KPQR000000000000000A', 'implement', 'success')`,
  )
  return db
}

describe('verifyAndGate', () => {
  it('returns "pass" when all commands succeed and writes rows', async () => {
    const db = seedDb()
    const cfg = ConfigSchema.parse({
      agent: { state_root: tempRoot },
      verify: {
        commands: [
          { label: 'ok1', run: 'exit 0', timeout_ms: 5000 },
          { label: 'ok2', run: 'exit 0', timeout_ms: 5000 },
        ],
      },
    })
    const verdict = await verifyAndGate({
      agentRunId: 'RUN1',
      config: cfg,
      db,
      taskId: '01HYX3KPQR000000000000000A',
      workspacePath: wsRoot,
    })
    expect(verdict).toBe('pass')
    const rows = listVerificationRunsForTask(db, '01HYX3KPQR000000000000000A')
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.exitCode === 0)).toBe(true)
  })

  it('returns "fail" when any command fails', async () => {
    const db = seedDb()
    const cfg = ConfigSchema.parse({
      agent: { state_root: tempRoot },
      verify: {
        commands: [
          { label: 'ok', run: 'exit 0', timeout_ms: 5000 },
          { label: 'nope', run: 'exit 2', timeout_ms: 5000 },
        ],
      },
    })
    const verdict = await verifyAndGate({
      agentRunId: 'RUN1',
      config: cfg,
      db,
      taskId: '01HYX3KPQR000000000000000A',
      workspacePath: wsRoot,
    })
    expect(verdict).toBe('fail')
    const rows = listVerificationRunsForTask(db, '01HYX3KPQR000000000000000A')
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.label === 'nope')?.exitCode).toBe(2)
  })

  it('returns "pass" when verify.enabled is false', async () => {
    const db = seedDb()
    const cfg = ConfigSchema.parse({
      agent: { state_root: tempRoot },
      verify: { commands: [{ label: 'x', run: 'exit 1' }], enabled: false },
    })
    const verdict = await verifyAndGate({
      agentRunId: 'RUN1',
      config: cfg,
      db,
      taskId: '01HYX3KPQR000000000000000A',
      workspacePath: wsRoot,
    })
    expect(verdict).toBe('pass')
    expect(
      listVerificationRunsForTask(db, '01HYX3KPQR000000000000000A'),
    ).toHaveLength(0)
  })

  it('returns "pass" when no commands are configured', async () => {
    const db = seedDb()
    const cfg = ConfigSchema.parse({
      agent: { state_root: tempRoot },
      verify: { commands: [] },
    })
    const verdict = await verifyAndGate({
      agentRunId: 'RUN1',
      config: cfg,
      db,
      taskId: '01HYX3KPQR000000000000000A',
      workspacePath: wsRoot,
    })
    expect(verdict).toBe('pass')
  })

  it('honors per-task verify_commands JSON override', async () => {
    const db = seedDb()
    db.run(`UPDATE tasks SET verify_commands = ? WHERE id = ?`, [
      JSON.stringify([{ label: 'per-task', run: 'exit 0', timeout_ms: 1000 }]),
      '01HYX3KPQR000000000000000A',
    ])
    const cfg = ConfigSchema.parse({
      agent: { state_root: tempRoot },
      verify: {
        commands: [{ label: 'default', run: 'exit 1', timeout_ms: 1000 }],
      },
    })
    const verdict = await verifyAndGate({
      agentRunId: 'RUN1',
      config: cfg,
      db,
      taskId: '01HYX3KPQR000000000000000A',
      workspacePath: wsRoot,
    })
    expect(verdict).toBe('pass')
    const rows = listVerificationRunsForTask(db, '01HYX3KPQR000000000000000A')
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('per-task')
  })

  it('appends a summary entry to the scratchpad', async () => {
    const db = seedDb()
    const cfg = ConfigSchema.parse({
      agent: { state_root: tempRoot },
      verify: {
        commands: [{ label: 'lint', run: 'exit 0', timeout_ms: 2000 }],
      },
    })
    await verifyAndGate({
      agentRunId: 'RUN1',
      config: cfg,
      db,
      taskId: '01HYX3KPQR000000000000000A',
      workspacePath: wsRoot,
    })
    const sp = await Bun.file(
      join(tempRoot, '01HYX3KPQR000000000000000A', 'scratchpad.md'),
    ).text()
    expect(sp).toContain('VERIFY')
    expect(sp).toContain('lint: pass')
  })
})
