import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import {
  insertAgentRunForTest,
  type InsertAgentRunInput,
} from '../src/orchestrator/orchestrator'
import { createPlaybook } from '../src/playbooks'

describe('agent_runs insert with playbook_version_id', () => {
  it('records playbook_version_id when action is playbook:<name>', () => {
    const db = new Database(':memory:')
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
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, action, created_by, updated_by) VALUES ('T1','B1','C1','t','playbook:bump-dep','U1','U1')`,
    )
    const pb = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: '{}',
      description: 'd',
      displayName: 'Bump',
      name: 'bump-dep',
      promptTemplate: 'tpl',
    })

    const input: InsertAgentRunInput = {
      action: 'playbook:bump-dep',
      db,
      runId: 'R1',
      taskId: 'T1',
    }
    insertAgentRunForTest(input)

    const row = db
      .query('SELECT playbook_version_id FROM agent_runs WHERE id = ?')
      .get('R1') as { playbook_version_id: string | null }
    expect(row.playbook_version_id).toBe(pb.currentVersion.id)
  })

  it('records NULL playbook_version_id for built-in actions', () => {
    const db = new Database(':memory:')
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
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, action, created_by, updated_by) VALUES ('T1','B1','C1','t','plan','U1','U1')`,
    )
    insertAgentRunForTest({ action: 'plan', db, runId: 'R1', taskId: 'T1' })
    const row = db
      .query('SELECT playbook_version_id FROM agent_runs WHERE id = ?')
      .get('R1') as { playbook_version_id: string | null }
    expect(row.playbook_version_id).toBeNull()
  })

  it('records NULL when the playbook is missing (soft-degrade, log only)', () => {
    const db = new Database(':memory:')
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
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, action, created_by, updated_by) VALUES ('T1','B1','C1','t','playbook:nope','U1','U1')`,
    )
    insertAgentRunForTest({
      action: 'playbook:nope',
      db,
      runId: 'R1',
      taskId: 'T1',
    })
    const row = db
      .query('SELECT playbook_version_id FROM agent_runs WHERE id = ?')
      .get('R1') as { playbook_version_id: string | null }
    expect(row.playbook_version_id).toBeNull()
  })
})
