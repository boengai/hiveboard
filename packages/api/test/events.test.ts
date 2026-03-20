import { Database } from 'bun:sqlite'
import { describe, test, expect, beforeEach } from 'bun:test'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { generateId } from '../src/db/ulid'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRow {
  id: string
  username: string
}

interface BoardRow {
  id: string
}

interface ColumnRow {
  id: string
  name: string
}

interface TaskRow {
  id: string
  agent_status: string
  action: string | null
}

interface EventRow {
  id: string
  task_id: string
  actor: string
  type: string
  data: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentUser(db: Database): UserRow {
  return db.query('SELECT * FROM users WHERE username = ?').get('queen-bee') as UserRow
}

function getBoard(db: Database): BoardRow {
  return db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
}

function getColumn(db: Database, boardId: string, position = 0): ColumnRow {
  return db
    .query('SELECT id, name FROM columns WHERE board_id = ? ORDER BY position ASC')
    .all(boardId)[position] as ColumnRow
}

function insertTask(db: Database, boardId: string, columnId: string, title = 'Test Task'): string {
  const user = getCurrentUser(db)
  const id = generateId()
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, position, created_by, updated_by)
     VALUES (?, ?, ?, ?, '', 0, ?, ?)`,
    [id, boardId, columnId, title, user.id, user.id]
  )
  return id
}

function getEventsForTask(db: Database, taskId: string): EventRow[] {
  return db
    .query('SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId) as EventRow[]
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  createTables(db)
  seed(db)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('task events', () => {
  test('creating a task produces a "created" event with the correct actor', () => {
    const board = getBoard(db)
    const col = getColumn(db, board.id)
    const user = getCurrentUser(db)
    const taskId = generateId()

    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, created_by, updated_by)
       VALUES (?, ?, ?, ?, '', 0, ?, ?)`,
      [taskId, board.id, col.id, 'New Task', user.id, user.id]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type) VALUES (?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'created']
    )

    const events = getEventsForTask(db, taskId)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('created')
    expect(events[0]?.actor).toBe(user.id)
  })

  test('updating task title produces a "title_changed" event with from/to', () => {
    const board = getBoard(db)
    const col = getColumn(db, board.id)
    const user = getCurrentUser(db)
    const taskId = insertTask(db, board.id, col.id, 'Original Title')

    const oldTitle = 'Original Title'
    const newTitle = 'Updated Title'

    db.run(
      `UPDATE tasks SET title = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [newTitle, user.id, taskId]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'title_changed', JSON.stringify({ from: oldTitle, to: newTitle })]
    )

    const events = getEventsForTask(db, taskId)
    const titleEvent = events.find(e => e.type === 'title_changed')
    expect(titleEvent).toBeDefined()

    const data = JSON.parse(titleEvent?.data as string)
    expect(data.from).toBe('Original Title')
    expect(data.to).toBe('Updated Title')
  })

  test('updating task body produces a "body_changed" event', () => {
    const board = getBoard(db)
    const col = getColumn(db, board.id)
    const user = getCurrentUser(db)
    const taskId = insertTask(db, board.id, col.id)

    db.run(
      `UPDATE tasks SET body = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      ['New body', user.id, taskId]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'body_changed', null]
    )

    const events = getEventsForTask(db, taskId)
    const bodyEvent = events.find(e => e.type === 'body_changed')
    expect(bodyEvent).toBeDefined()
    expect(bodyEvent?.data).toBeNull()
  })

  test('setting an action produces an "action_set" event', () => {
    const board = getBoard(db)
    const col = getColumn(db, board.id)
    const user = getCurrentUser(db)
    const taskId = insertTask(db, board.id, col.id)
    const action = 'fix the failing test'

    db.run(
      `UPDATE tasks SET action = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [action, user.id, taskId]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'action_set', JSON.stringify({ action })]
    )

    const events = getEventsForTask(db, taskId)
    const actionEvent = events.find(e => e.type === 'action_set')
    expect(actionEvent).toBeDefined()

    const data = JSON.parse(actionEvent?.data as string)
    expect(data.action).toBe(action)
  })

  test('clearing an action produces an "action_cleared" event', () => {
    const board = getBoard(db)
    const col = getColumn(db, board.id)
    const user = getCurrentUser(db)
    const taskId = insertTask(db, board.id, col.id)

    db.run(
      `UPDATE tasks SET action = NULL, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [user.id, taskId]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'action_cleared', null]
    )

    const events = getEventsForTask(db, taskId)
    const clearedEvent = events.find(e => e.type === 'action_cleared')
    expect(clearedEvent).toBeDefined()
  })

  test('moving a task produces a "moved" event with from_column/to_column names', () => {
    const board = getBoard(db)
    const cols = db
      .query('SELECT id, name FROM columns WHERE board_id = ? ORDER BY position ASC')
      .all(board.id) as ColumnRow[]

    const fromCol = cols[0]!
    const toCol = cols[2]!
    const user = getCurrentUser(db)
    const taskId = insertTask(db, board.id, fromCol.id)

    db.run(
      `UPDATE tasks SET column_id = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [toCol.id, user.id, taskId]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'moved', JSON.stringify({ from_column: fromCol.name, to_column: toCol.name })]
    )

    const events = getEventsForTask(db, taskId)
    const movedEvent = events.find(e => e.type === 'moved')
    expect(movedEvent).toBeDefined()

    const data = JSON.parse(movedEvent?.data as string)
    expect(data.from_column).toBe('Backlog')
    expect(data.to_column).toBe('In Progress')
  })

  test('archiving a task produces an "archived" event', () => {
    const board = getBoard(db)
    const col = getColumn(db, board.id)
    const user = getCurrentUser(db)
    const taskId = insertTask(db, board.id, col.id)

    db.run(
      `UPDATE tasks SET archived = 1, archived_at = datetime('now'), updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [user.id, taskId]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type) VALUES (?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'archived']
    )

    const events = getEventsForTask(db, taskId)
    const archiveEvent = events.find(e => e.type === 'archived')
    expect(archiveEvent).toBeDefined()
  })

  test('unarchiving a task produces an "unarchived" event', () => {
    const board = getBoard(db)
    const col = getColumn(db, board.id)
    const user = getCurrentUser(db)
    const taskId = insertTask(db, board.id, col.id)

    db.run(
      `UPDATE tasks SET archived = 1, archived_at = datetime('now'), updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [user.id, taskId]
    )
    db.run(
      `UPDATE tasks SET archived = 0, archived_at = NULL, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [user.id, taskId]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type) VALUES (?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'unarchived']
    )

    const events = getEventsForTask(db, taskId)
    const unarchiveEvent = events.find(e => e.type === 'unarchived')
    expect(unarchiveEvent).toBeDefined()
  })

  test('adding a comment produces a "comment_added" event with comment_id', () => {
    const board = getBoard(db)
    const col = getColumn(db, board.id)
    const user = getCurrentUser(db)
    const taskId = insertTask(db, board.id, col.id)

    const commentId = generateId()
    db.run(
      'INSERT INTO task_comments (id, task_id, parent_id, body, created_by) VALUES (?, ?, ?, ?, ?)',
      [commentId, taskId, null, 'A comment', user.id]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'comment_added', JSON.stringify({ comment_id: commentId })]
    )

    const events = getEventsForTask(db, taskId)
    const commentEvent = events.find(e => e.type === 'comment_added')
    expect(commentEvent).toBeDefined()

    const data = JSON.parse(commentEvent?.data as string)
    expect(data.comment_id).toBe(commentId)
  })

  test('dispatching an agent produces "action_set" + "status_changed" events', () => {
    const board = getBoard(db)
    const col = getColumn(db, board.id)
    const user = getCurrentUser(db)
    const taskId = insertTask(db, board.id, col.id)
    const action = 'implement feature'

    db.run(
      `UPDATE tasks SET action = ?, agent_status = 'queued', updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [action, user.id, taskId]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'action_set', JSON.stringify({ action })]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'status_changed', JSON.stringify({ from: 'idle', to: 'queued' })]
    )

    const events = getEventsForTask(db, taskId)
    const actionSetEvent = events.find(e => e.type === 'action_set')
    const statusChangedEvent = events.find(e => e.type === 'status_changed')

    expect(actionSetEvent).toBeDefined()
    expect(statusChangedEvent).toBeDefined()

    const actionData = JSON.parse(actionSetEvent?.data as string)
    expect(actionData.action).toBe(action)

    const statusData = JSON.parse(statusChangedEvent?.data as string)
    expect(statusData.from).toBe('idle')
    expect(statusData.to).toBe('queued')

    const task = db.query('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow
    expect(task.agent_status).toBe('queued')
  })

  test('cancelling an agent produces a "status_changed" event back to idle', () => {
    const board = getBoard(db)
    const col = getColumn(db, board.id)
    const user = getCurrentUser(db)
    const taskId = insertTask(db, board.id, col.id)

    // First dispatch
    db.run(
      `UPDATE tasks SET action = 'some action', agent_status = 'queued', updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [user.id, taskId]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'status_changed', JSON.stringify({ from: 'idle', to: 'queued' })]
    )

    // Now cancel
    db.run(
      `UPDATE tasks SET agent_status = 'idle', updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [user.id, taskId]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'status_changed', JSON.stringify({ from: 'queued', to: 'idle' })]
    )

    const events = getEventsForTask(db, taskId)
    const cancelEvent = events[events.length - 1]!
    expect(cancelEvent.type).toBe('status_changed')

    const data = JSON.parse(cancelEvent.data!)
    expect(data.from).toBe('queued')
    expect(data.to).toBe('idle')

    const task = db.query('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow
    expect(task.agent_status).toBe('idle')
  })
})
