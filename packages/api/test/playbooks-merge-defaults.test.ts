import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mergePlaybookDefaultsIntoTask } from '../src/playbooks/merge-defaults'
import { createTables } from '../src/db/schema'
import { createPlaybook } from '../src/playbooks'

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
  createTables(db)
  db.run(
    `INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`,
  )
  db.run(
    `INSERT INTO boards (id, name, created_by) VALUES ('B1','b','U1')`,
  )
  db.run(
    `INSERT INTO columns (id, board_id, name, position) VALUES ('C1','B1','c',0)`,
  )
})

afterEach(() => db.close())

describe('mergePlaybookDefaultsIntoTask', () => {
  it('fills task.target_branch when null; task wins when set', () => {
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, target_branch, created_by, updated_by) VALUES ('T1','B1','C1','t',NULL,'U1','U1')`,
    )
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, target_branch, created_by, updated_by) VALUES ('T2','B1','C1','t','release-2.0','U1','U1')`,
    )
    const pb = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: JSON.stringify({ target_branch: 'main' }),
      description: 'd',
      displayName: 'Bump',
      name: 'bump-dep',
      promptTemplate: 'tpl',
    })
    mergePlaybookDefaultsIntoTask(db, 'T1', pb.currentVersion)
    mergePlaybookDefaultsIntoTask(db, 'T2', pb.currentVersion)
    const t1 = db
      .query('SELECT target_branch FROM tasks WHERE id = ?')
      .get('T1') as { target_branch: string }
    const t2 = db
      .query('SELECT target_branch FROM tasks WHERE id = ?')
      .get('T2') as { target_branch: string }
    expect(t1.target_branch).toBe('main')
    expect(t2.target_branch).toBe('release-2.0')
  })

  it('unions tags rather than replacing them (creates missing tags on the board)', () => {
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, created_by, updated_by) VALUES ('T1','B1','C1','t','U1','U1')`,
    )
    db.run(
      `INSERT INTO tags (id, board_id, name) VALUES ('TAG1','B1','existing')`,
    )
    db.run(
      `INSERT INTO task_tags (task_id, tag_id) VALUES ('T1','TAG1')`,
    )
    const pb = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: JSON.stringify({ tags: ['existing', 'flake'] }),
      description: 'd',
      displayName: 'Triage',
      name: 'triage-flake',
      promptTemplate: 'tpl',
    })
    mergePlaybookDefaultsIntoTask(db, 'T1', pb.currentVersion)
    const names = db
      .query(
        `SELECT tags.name FROM task_tags JOIN tags ON tags.id = task_tags.tag_id WHERE task_tags.task_id = 'T1' ORDER BY tags.name`,
      )
      .all() as Array<{ name: string }>
    expect(names.map((n) => n.name)).toEqual(['existing', 'flake'])
  })

  it('populates verify_commands when task has none', () => {
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, verify_commands, created_by, updated_by) VALUES ('T1','B1','C1','t',NULL,'U1','U1')`,
    )
    const pb = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: JSON.stringify({
        verify_commands: ['test', 'tsc'],
      }),
      description: 'd',
      displayName: 'Bump',
      name: 'bump-dep',
      promptTemplate: 'tpl',
    })
    mergePlaybookDefaultsIntoTask(db, 'T1', pb.currentVersion)
    const row = db
      .query('SELECT verify_commands FROM tasks WHERE id = ?')
      .get('T1') as { verify_commands: string }
    expect(row.verify_commands).toBeTruthy()
    expect(JSON.parse(row.verify_commands)).toEqual(['test', 'tsc'])
  })

  it('populates time_box_ms when task has none', () => {
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, time_box_ms, created_by, updated_by) VALUES ('T1','B1','C1','t',NULL,'U1','U1')`,
    )
    const pb = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: JSON.stringify({ time_box_ms: 1_800_000 }),
      description: 'd',
      displayName: 'Triage',
      name: 'triage-flake',
      promptTemplate: 'tpl',
    })
    mergePlaybookDefaultsIntoTask(db, 'T1', pb.currentVersion)
    const row = db
      .query('SELECT time_box_ms FROM tasks WHERE id = ?')
      .get('T1') as { time_box_ms: number }
    expect(row.time_box_ms).toBe(1_800_000)
  })

  it('is a no-op when defaults_json is {}', () => {
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, target_branch, created_by, updated_by) VALUES ('T1','B1','C1','t','feature/x','U1','U1')`,
    )
    const pb = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: '{}',
      description: 'd',
      displayName: 'Empty',
      name: 'empty',
      promptTemplate: 'tpl',
    })
    mergePlaybookDefaultsIntoTask(db, 'T1', pb.currentVersion)
    const row = db
      .query('SELECT target_branch FROM tasks WHERE id = ?')
      .get('T1') as { target_branch: string }
    expect(row.target_branch).toBe('feature/x')
  })
})
