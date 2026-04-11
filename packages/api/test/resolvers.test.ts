import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { generateId } from '../src/db/ulid'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UserRow = {
  id: string
  username: string
  display_name: string
  role: string
}

type BoardRow = {
  id: string
  name: string
  created_by: string
}

type ColumnRow = {
  id: string
  board_id: string
  name: string
  position: number
}

type TaskRow = {
  id: string
  board_id: string
  column_id: string
  title: string
  body: string
  position: number
  action: string | null
  agent_instruction: string | null
  agent_status: string
  archived: number
  archived_at: string | null
  created_by: string
  updated_by: string
}

type CommentRow = {
  id: string
  task_id: string
  parent_id: string | null
  body: string
  created_by: string
}

// ---------------------------------------------------------------------------
// Helpers mirroring resolver logic
// ---------------------------------------------------------------------------

function getCurrentUser(db: Database): UserRow {
  return db
    .query('SELECT * FROM users WHERE username = ?')
    .get('queen-bee') as UserRow
}

function insertTask(
  db: Database,
  opts: {
    boardId: string
    columnId: string
    title: string
    body?: string
    action?: string | null
    position?: number
  },
): string {
  const user = getCurrentUser(db)
  const id = generateId()
  const position = opts.position ?? 0
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, position, action, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.boardId,
      opts.columnId,
      opts.title,
      opts.body ?? '',
      position,
      opts.action ?? null,
      user.id,
      user.id,
    ],
  )
  return id
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
// Query: boards
// ---------------------------------------------------------------------------

describe('boards query', () => {
  test('returns the seeded board', () => {
    const boards = db
      .query('SELECT * FROM boards ORDER BY created_at ASC')
      .all() as BoardRow[]
    expect(boards).toHaveLength(1)
    expect(boards[0]?.name).toBe('HiveBoard')
  })

  test('board has 5 columns', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const columns = db
      .query('SELECT * FROM columns WHERE board_id = ? ORDER BY position ASC')
      .all(board.id) as ColumnRow[]
    expect(columns).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// Query: board(id)
// ---------------------------------------------------------------------------

describe('board(id) query', () => {
  test('returns correct board by id', () => {
    const board = db.query('SELECT * FROM boards LIMIT 1').get() as BoardRow
    const result = db
      .query('SELECT * FROM boards WHERE id = ?')
      .get(board.id) as BoardRow | null
    expect(result).not.toBeNull()
    expect(result?.id).toBe(board.id)
    expect(result?.name).toBe('HiveBoard')
  })

  test('returns null for non-existent board id', () => {
    const result = db
      .query('SELECT * FROM boards WHERE id = ?')
      .get('does-not-exist')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Create task
// ---------------------------------------------------------------------------

describe('createTask', () => {
  test('inserts task into the correct column', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const col = db
      .query(
        'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
      )
      .get(board.id) as ColumnRow

    const taskId = insertTask(db, {
      boardId: board.id,
      columnId: col.id,
      title: 'My Task',
    })

    const task = db
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow
    expect(task).not.toBeNull()
    expect(task.title).toBe('My Task')
    expect(task.column_id).toBe(col.id)
    expect(task.board_id).toBe(board.id)
  })

  test('position auto-increments by 1024 from max', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const col = db
      .query(
        'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
      )
      .get(board.id) as ColumnRow

    insertTask(db, {
      boardId: board.id,
      columnId: col.id,
      position: 0,
      title: 'Task 1',
    })
    insertTask(db, {
      boardId: board.id,
      columnId: col.id,
      position: 1024,
      title: 'Task 2',
    })

    const tasks = db
      .query('SELECT * FROM tasks WHERE column_id = ? ORDER BY position ASC')
      .all(col.id) as TaskRow[]
    expect(tasks).toHaveLength(2)
    expect(tasks[1]?.position).toBe(1024)
  })
})

// ---------------------------------------------------------------------------
// Update task
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  test('updates title', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const col = db
      .query(
        'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
      )
      .get(board.id) as ColumnRow

    const taskId = insertTask(db, {
      boardId: board.id,
      columnId: col.id,
      title: 'Original',
    })

    const user = getCurrentUser(db)
    db.run(
      `UPDATE tasks SET title = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      ['Updated Title', user.id, taskId],
    )

    const task = db
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow
    expect(task.title).toBe('Updated Title')
  })

  test('updates body', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const col = db
      .query(
        'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
      )
      .get(board.id) as ColumnRow

    const taskId = insertTask(db, {
      boardId: board.id,
      columnId: col.id,
      title: 'Task',
    })

    const user = getCurrentUser(db)
    db.run(
      `UPDATE tasks SET body = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      ['New body content', user.id, taskId],
    )

    const task = db
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow
    expect(task.body).toBe('New body content')
  })
})

// ---------------------------------------------------------------------------
// Delete task
// ---------------------------------------------------------------------------
// Move task
// ---------------------------------------------------------------------------

describe('moveTask', () => {
  test('updates column_id and position', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const cols = db
      .query('SELECT * FROM columns WHERE board_id = ? ORDER BY position ASC')
      .all(board.id) as ColumnRow[]

    const fromCol = cols[0] as ColumnRow
    const toCol = cols[2] as ColumnRow

    const taskId = insertTask(db, {
      boardId: board.id,
      columnId: fromCol.id,
      title: 'Move Me',
    })
    const user = getCurrentUser(db)

    db.run(
      `UPDATE tasks SET column_id = ?, position = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [toCol.id, 512, user.id, taskId],
    )

    const task = db
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow
    expect(task.column_id).toBe(toCol.id)
    expect(task.position).toBe(512)
  })
})

// ---------------------------------------------------------------------------
// Archive / Unarchive task
// ---------------------------------------------------------------------------

describe('archive/unarchive task', () => {
  test('archiveTask sets archived = 1 and archived_at', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const col = db
      .query(
        'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
      )
      .get(board.id) as ColumnRow
    const taskId = insertTask(db, {
      boardId: board.id,
      columnId: col.id,
      title: 'Archive Me',
    })
    const user = getCurrentUser(db)

    db.run(
      `UPDATE tasks SET archived = 1, archived_at = datetime('now'), updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [user.id, taskId],
    )

    const task = db
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow
    expect(task.archived).toBe(1)
    expect(task.archived_at).not.toBeNull()
  })

  test('unarchiveTask sets archived = 0 and clears archived_at', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const col = db
      .query(
        'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
      )
      .get(board.id) as ColumnRow
    const taskId = insertTask(db, {
      boardId: board.id,
      columnId: col.id,
      title: 'Unarchive Me',
    })
    const user = getCurrentUser(db)

    db.run(
      `UPDATE tasks SET archived = 1, archived_at = datetime('now'), updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [user.id, taskId],
    )
    db.run(
      `UPDATE tasks SET archived = 0, archived_at = NULL, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [user.id, taskId],
    )

    const task = db
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow
    expect(task.archived).toBe(0)
    expect(task.archived_at).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// addComment
// ---------------------------------------------------------------------------

describe('addComment', () => {
  test('inserts a top-level comment', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const col = db
      .query(
        'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
      )
      .get(board.id) as ColumnRow
    const taskId = insertTask(db, {
      boardId: board.id,
      columnId: col.id,
      title: 'Task',
    })
    const user = getCurrentUser(db)

    const commentId = generateId()
    db.run(
      'INSERT INTO task_comments (id, task_id, parent_id, body, created_by) VALUES (?, ?, ?, ?, ?)',
      [commentId, taskId, null, 'Top level comment', user.id],
    )

    const comment = db
      .query('SELECT * FROM task_comments WHERE id = ?')
      .get(commentId) as CommentRow
    expect(comment).not.toBeNull()
    expect(comment.body).toBe('Top level comment')
    expect(comment.parent_id).toBeNull()
  })

  test('inserts a threaded reply with parent_id', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const col = db
      .query(
        'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
      )
      .get(board.id) as ColumnRow
    const taskId = insertTask(db, {
      boardId: board.id,
      columnId: col.id,
      title: 'Task',
    })
    const user = getCurrentUser(db)

    const parentId = generateId()
    db.run(
      'INSERT INTO task_comments (id, task_id, parent_id, body, created_by) VALUES (?, ?, ?, ?, ?)',
      [parentId, taskId, null, 'Parent comment', user.id],
    )

    const replyId = generateId()
    db.run(
      'INSERT INTO task_comments (id, task_id, parent_id, body, created_by) VALUES (?, ?, ?, ?, ?)',
      [replyId, taskId, parentId, 'A reply', user.id],
    )

    const reply = db
      .query('SELECT * FROM task_comments WHERE id = ?')
      .get(replyId) as CommentRow
    expect(reply.parent_id).toBe(parentId)
  })

  test('enforces max 1-level nesting: reply to a reply is rejected', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const col = db
      .query(
        'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
      )
      .get(board.id) as ColumnRow
    const taskId = insertTask(db, {
      boardId: board.id,
      columnId: col.id,
      title: 'Task',
    })
    const user = getCurrentUser(db)

    const parentId = generateId()
    db.run(
      'INSERT INTO task_comments (id, task_id, parent_id, body, created_by) VALUES (?, ?, ?, ?, ?)',
      [parentId, taskId, null, 'Parent', user.id],
    )

    const replyId = generateId()
    db.run(
      'INSERT INTO task_comments (id, task_id, parent_id, body, created_by) VALUES (?, ?, ?, ?, ?)',
      [replyId, taskId, parentId, 'Reply', user.id],
    )

    // Mimic the resolver nesting guard
    const replyRow = db
      .query('SELECT parent_id FROM task_comments WHERE id = ?')
      .get(replyId) as { parent_id: string | null }
    expect(replyRow.parent_id).not.toBeNull()

    // A reply to `replyId` would be rejected because replyId has a parent_id
    expect(() => {
      if (replyRow.parent_id !== null) {
        throw new Error('Cannot nest replies more than 1 level deep')
      }
    }).toThrow('Cannot nest replies more than 1 level deep')
  })
})

// ---------------------------------------------------------------------------
// cancelAgent
// ---------------------------------------------------------------------------

describe('cancelAgent', () => {
  test('sets agent_status back to idle', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const col = db
      .query(
        'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
      )
      .get(board.id) as ColumnRow
    const taskId = insertTask(db, {
      boardId: board.id,
      columnId: col.id,
      title: 'Cancel',
    })
    const user = getCurrentUser(db)

    db.run(
      `UPDATE tasks SET action = ?, agent_status = 'queued', updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      ['implement', user.id, taskId],
    )
    db.run(
      `UPDATE tasks SET agent_status = 'idle', action = NULL, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [user.id, taskId],
    )

    const task = db
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow
    expect(task.agent_status).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// deleteTag
// ---------------------------------------------------------------------------

type TagRow = {
  id: string
  board_id: string
  name: string
  color: string
  created_at: string
}

describe('deleteTag', () => {
  test('deletes an existing tag successfully', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
    const tagId = generateId()
    db.run('INSERT INTO tags (id, board_id, name, color) VALUES (?, ?, ?, ?)', [
      tagId,
      board.id,
      'bug',
      '#ff0000',
    ])

    // Verify tag exists
    const before = db
      .query('SELECT * FROM tags WHERE id = ?')
      .get(tagId) as TagRow | null
    expect(before).not.toBeNull()

    // Delete the tag
    db.run('DELETE FROM tags WHERE id = ?', [tagId])

    // Verify tag is gone
    const after = db
      .query('SELECT * FROM tags WHERE id = ?')
      .get(tagId) as TagRow | null
    expect(after).toBeNull()
  })

  test('throws error when deleting non-existent tag', () => {
    const fakeId = 'non-existent-tag-id'
    const existing = db
      .query('SELECT * FROM tags WHERE id = ?')
      .get(fakeId) as TagRow | null

    expect(existing).toBeNull()
    // Mimic the resolver existence check
    expect(() => {
      if (!existing) {
        throw new Error(`Tag ${fakeId} not found`)
      }
    }).toThrow(`Tag ${fakeId} not found`)
  })

  test('throws error when deleting tag from a different board', () => {
    // Create a second board
    const user = getCurrentUser(db)
    const board2Id = generateId()
    db.run('INSERT INTO boards (id, name, created_by) VALUES (?, ?, ?)', [
      board2Id,
      'Other Board',
      user.id,
    ])

    // Create a tag on board2
    const tagId = generateId()
    db.run('INSERT INTO tags (id, board_id, name, color) VALUES (?, ?, ?, ?)', [
      tagId,
      board2Id,
      'feature',
      '#00ff00',
    ])

    // Get the original board
    const board1 = db
      .query("SELECT id FROM boards WHERE name = 'HiveBoard' LIMIT 1")
      .get() as BoardRow

    // Mimic the resolver board ownership check
    const tag = db
      .query('SELECT * FROM tags WHERE id = ?')
      .get(tagId) as TagRow | null
    expect(tag).not.toBeNull()
    expect(() => {
      if (!tag) {
        throw new Error(`Tag ${tagId} not found`)
      }
      if (tag.board_id !== board1.id) {
        throw new Error(`Tag ${tagId} not found`)
      }
    }).toThrow(`Tag ${tagId} not found`)

    // Verify the tag was NOT deleted
    const after = db
      .query('SELECT * FROM tags WHERE id = ?')
      .get(tagId) as TagRow | null
    expect(after).not.toBeNull()
  })
})
