import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import {
  getSnapshotById,
  getSnapshotPatch,
  insertSnapshot,
  listSnapshotsForTask,
  sumPatchBytesForTask,
} from '../src/db/workspace-snapshots'

function setup(): Database {
  const db = new Database(':memory:')
  createTables(db)
  db.run(`INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`)
  db.run(`INSERT INTO boards (id, name, created_by) VALUES ('B1','b','U1')`)
  db.run(
    `INSERT INTO columns (id, board_id, name, position) VALUES ('C1','B1','c',0)`,
  )
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, created_by, updated_by)
     VALUES ('01HYX3KPQR000000000000000A','B1','C1','t','U1','U1')`,
  )
  return db
}

const TASK_ID = '01HYX3KPQR000000000000000A'

describe('workspace_snapshots DB layer', () => {
  it('insertSnapshot + listSnapshotsForTask round-trip (patch omitted from list)', () => {
    const db = setup()
    const id = insertSnapshot(db, {
      agentRunId: null,
      fileStatus: '[]',
      patch: Buffer.from('gzipped-bytes'),
      statHash: 'hash1',
      statSummary: ' 1 file changed',
      taskId: TASK_ID,
    })
    const rows = listSnapshotsForTask(db, TASK_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(id)
    expect(rows[0]?.statHash).toBe('hash1')
    expect(rows[0]?.hasPatch).toBe(true)
    // list omits patch bytes
    expect('patch' in (rows[0] ?? {})).toBe(false)
  })

  it('hasPatch=false when patch is null', () => {
    const db = setup()
    insertSnapshot(db, {
      agentRunId: null,
      fileStatus: '[]',
      patch: null,
      statHash: 'hash2',
      statSummary: 'summary',
      taskId: TASK_ID,
    })
    const rows = listSnapshotsForTask(db, TASK_ID)
    expect(rows[0]?.hasPatch).toBe(false)
  })

  it('getSnapshotPatch returns the stored bytes', () => {
    const db = setup()
    const id = insertSnapshot(db, {
      agentRunId: null,
      fileStatus: '[]',
      patch: Buffer.from('abc'),
      statHash: 'h',
      statSummary: 's',
      taskId: TASK_ID,
    })
    const patch = getSnapshotPatch(db, id)
    expect(patch?.toString()).toBe('abc')
  })

  it('getSnapshotPatch returns null when stored patch is null', () => {
    const db = setup()
    const id = insertSnapshot(db, {
      agentRunId: null,
      fileStatus: '[]',
      patch: null,
      statHash: 'h',
      statSummary: 's',
      taskId: TASK_ID,
    })
    expect(getSnapshotPatch(db, id)).toBeNull()
  })

  it('sumPatchBytesForTask sums only non-null patches', () => {
    const db = setup()
    insertSnapshot(db, {
      agentRunId: null,
      fileStatus: '[]',
      patch: Buffer.alloc(100),
      statHash: 'a',
      statSummary: 's',
      taskId: TASK_ID,
    })
    insertSnapshot(db, {
      agentRunId: null,
      fileStatus: '[]',
      patch: null,
      statHash: 'b',
      statSummary: 's',
      taskId: TASK_ID,
    })
    insertSnapshot(db, {
      agentRunId: null,
      fileStatus: '[]',
      patch: Buffer.alloc(200),
      statHash: 'c',
      statSummary: 's',
      taskId: TASK_ID,
    })
    expect(sumPatchBytesForTask(db, TASK_ID)).toBe(300)
  })

  it('getSnapshotById returns null for unknown id', () => {
    const db = setup()
    expect(getSnapshotById(db, 'missing')).toBeNull()
  })
})
