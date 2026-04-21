import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import {
  getCurrentQuestion,
  insertMessage,
  listMessagesForTask,
  listUndeliveredHumanMessages,
  markMessagesDelivered,
} from '../src/db/task-messages'

function setup(): Database {
  const db = new Database(':memory:')
  createTables(db)
  return db
}

describe('task_messages DB layer', () => {
  it('insertMessage + listMessagesForTask round trip', () => {
    const db = setup()
    const id = insertMessage(db, {
      authorType: 'human',
      body: 'hello',
      createdBy: 'U1',
      kind: 'hint',
      taskId: 'T1',
    })
    const rows = listMessagesForTask(db, 'T1')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(id)
    expect(rows[0].body).toBe('hello')
    expect(rows[0].deliveredAt).toBeNull()
  })

  it('listUndeliveredHumanMessages filters correctly', () => {
    const db = setup()
    insertMessage(db, {
      authorType: 'human',
      body: 'h',
      createdBy: 'U1',
      kind: 'hint',
      taskId: 'T1',
    })
    insertMessage(db, {
      authorType: 'agent',
      body: 'q',
      createdBy: null,
      kind: 'question',
      taskId: 'T1',
    })
    const undelivered = listUndeliveredHumanMessages(db, 'T1')
    expect(undelivered).toHaveLength(1)
    expect(undelivered[0].kind).toBe('hint')
  })

  it('markMessagesDelivered stamps delivered_at', () => {
    const db = setup()
    const id = insertMessage(db, {
      authorType: 'human',
      body: 'h',
      createdBy: 'U1',
      kind: 'hint',
      taskId: 'T1',
    })
    markMessagesDelivered(db, [id])
    const rows = listMessagesForTask(db, 'T1')
    expect(rows[0].deliveredAt).not.toBeNull()
  })

  it('markMessagesDelivered with empty array is a no-op', () => {
    const db = setup()
    insertMessage(db, {
      authorType: 'human',
      body: 'h',
      createdBy: 'U1',
      kind: 'hint',
      taskId: 'T1',
    })
    markMessagesDelivered(db, [])
    const rows = listMessagesForTask(db, 'T1')
    expect(rows[0].deliveredAt).toBeNull()
  })

  it('getCurrentQuestion returns the latest question or null', () => {
    const db = setup()
    expect(getCurrentQuestion(db, 'T1')).toBeNull()
    insertMessage(db, {
      authorType: 'agent',
      body: 'Postgres or MySQL?',
      createdBy: null,
      kind: 'question',
      taskId: 'T1',
    })
    const q = getCurrentQuestion(db, 'T1')
    expect(q).not.toBeNull()
    expect(q?.body).toBe('Postgres or MySQL?')
  })
})
