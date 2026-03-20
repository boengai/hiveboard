import { Database } from 'bun:sqlite'
import { generateId } from './ulid'

export function seed(db: Database): void {
  const existingUser = db.query('SELECT id FROM users WHERE username = ?').get('queen-bee')
  if (existingUser) return

  const userId = generateId()
  const boardId = generateId()

  db.exec('BEGIN')
  try {
    db.run('INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)',
      [userId, 'queen-bee', 'Queen Bee', 'admin'])

    db.run('INSERT INTO boards (id, name, created_by) VALUES (?, ?, ?)',
      [boardId, 'HiveBoard', userId])

    const columns: string[] = ['Backlog', 'Todo', 'In Progress', 'Review', 'Done']
    for (let i = 0; i < columns.length; i++) {
      const colName = columns[i] as string
      db.run('INSERT INTO columns (id, board_id, name, position) VALUES (?, ?, ?, ?)',
        [generateId(), boardId, colName, i])
    }

    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
