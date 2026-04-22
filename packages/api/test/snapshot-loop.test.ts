import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '../src/config/schema'
import { createTables } from '../src/db/schema'
import { listSnapshotsForTask } from '../src/db/workspace-snapshots'
import { captureWorkspaceSnapshot } from '../src/orchestrator/snapshot-loop'
import * as pubsubMod from '../src/pubsub'

const TASK_ID = '01HYX3KPQR000000000000000A'

function seedTaskRow(db: Database) {
  db.run(`INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`)
  db.run(`INSERT INTO boards (id, name, created_by) VALUES ('B1','b','U1')`)
  db.run(
    `INSERT INTO columns (id, board_id, name, position) VALUES ('C1','B1','c',0)`,
  )
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, created_by, updated_by)
     VALUES (?, 'B1', 'C1', 't', 'U1', 'U1')`,
    [TASK_ID],
  )
}

async function run(cmd: string[], cwd: string): Promise<void> {
  const p = Bun.spawn(cmd, { cwd, stderr: 'pipe', stdout: 'pipe' })
  await p.exited
}

let tempRoot: string
let db: Database
let workspacePath: string
let config: ReturnType<typeof ConfigSchema.parse>

beforeEach(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'hb-snap-'))
  workspacePath = join(tempRoot, 'repo')
  mkdirSync(workspacePath, { recursive: true })
  await run(['git', 'init', '-q'], workspacePath)
  await run(['git', 'config', 'user.email', 't@t'], workspacePath)
  await run(['git', 'config', 'user.name', 'T'], workspacePath)
  writeFileSync(join(workspacePath, 'seed.txt'), 'seed\n')
  await run(['git', 'add', '.'], workspacePath)
  await run(['git', 'commit', '-q', '-m', 'seed'], workspacePath)
  db = new Database(':memory:')
  createTables(db)
  seedTaskRow(db)
  config = ConfigSchema.parse({})
})

afterEach(() => {
  rmSync(tempRoot, { force: true, recursive: true })
})

describe('captureWorkspaceSnapshot', () => {
  it('captures staged + unstaged changes and stores compressed patch', async () => {
    writeFileSync(join(workspacePath, 'seed.txt'), 'seed\nmore\n')
    writeFileSync(join(workspacePath, 'new.txt'), 'brand new\n')

    const inserted = await captureWorkspaceSnapshot({
      agentRunId: null,
      config,
      db,
      lastStatHash: null,
      taskId: TASK_ID,
      workspacePath,
    })

    expect(inserted).not.toBeNull()
    const rows = listSnapshotsForTask(db, TASK_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.hasPatch).toBe(true)
    expect(rows[0]?.statSummary.length ?? 0).toBeGreaterThan(0)
    const parsed = JSON.parse(rows[0]?.fileStatus ?? '[]')
    const paths = parsed.map((e: { path: string }) => e.path).sort()
    expect(paths).toEqual(['new.txt', 'seed.txt'])
  })

  it('returns null (skips insert) when stat hash is unchanged', async () => {
    writeFileSync(join(workspacePath, 'seed.txt'), 'seed\nmore\n')
    const first = await captureWorkspaceSnapshot({
      agentRunId: null,
      config,
      db,
      lastStatHash: null,
      taskId: TASK_ID,
      workspacePath,
    })
    expect(first).not.toBeNull()
    const again = await captureWorkspaceSnapshot({
      agentRunId: null,
      config,
      db,
      lastStatHash: first?.statHash ?? null,
      taskId: TASK_ID,
      workspacePath,
    })
    expect(again).toBeNull()
    expect(listSnapshotsForTask(db, TASK_ID)).toHaveLength(1)
  })

  it('stores patch=null once the per-task byte budget is exceeded', async () => {
    const cfg = ConfigSchema.parse({
      progress: { snapshot_disk_budget_mb: 1 },
    })

    const big = Buffer.alloc(2 * 1024 * 1024, 'A').toString('utf8')
    writeFileSync(join(workspacePath, 'big.txt'), big)

    await captureWorkspaceSnapshot({
      agentRunId: null,
      config: cfg,
      db,
      lastStatHash: null,
      taskId: TASK_ID,
      workspacePath,
    })

    writeFileSync(join(workspacePath, 'big.txt'), `${big}B`)
    const second = await captureWorkspaceSnapshot({
      agentRunId: null,
      config: cfg,
      db,
      lastStatHash: 'something-different',
      taskId: TASK_ID,
      workspacePath,
    })

    expect(second?.hasPatch).toBe(false)
    const rows = listSnapshotsForTask(db, TASK_ID)
    const budgetExceeded = rows.filter((r) => !r.hasPatch)
    expect(budgetExceeded.length).toBeGreaterThanOrEqual(1)
  })

  it('publishes WORKSPACE_SNAPSHOT with fileStatus as a parsed array (GraphQL-shaped)', async () => {
    writeFileSync(join(workspacePath, 'seed.txt'), 'seed\nmore\n')
    const publishSpy = spyOn(pubsubMod, 'publishWorkspaceSnapshot')
    publishSpy.mockClear()

    await captureWorkspaceSnapshot({
      agentRunId: null,
      config,
      db,
      lastStatHash: null,
      taskId: TASK_ID,
      workspacePath,
    })

    expect(publishSpy).toHaveBeenCalledTimes(1)
    const [, payload] = publishSpy.mock.calls[0] as [string, unknown]
    const typed = payload as {
      fileStatus: Array<{
        path: string
        status: string
        additions: number
        deletions: number
      }>
    }
    expect(Array.isArray(typed.fileStatus)).toBe(true)
    expect(typed.fileStatus[0]?.path).toBe('seed.txt')
    expect(typeof typed.fileStatus[0]?.additions).toBe('number')
    publishSpy.mockRestore()
  })
})
