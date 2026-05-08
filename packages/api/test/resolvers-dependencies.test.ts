/**
 * resolvers-dependencies.test.ts
 *
 * Covers Task 8: addTaskDependency / removeTaskDependency mutations and
 * Task.blockers / Task.dependents / Task.subtasks field resolvers.
 *
 * Harness mirrors resolvers-messages.test.ts: same shared memDb injection via
 * the module-level `db` import, same seed/migrate setup per test, same
 * makeCtx() auth helper.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { GraphQLError } from 'graphql'
import { db, generateId } from '../src/db'
import { migrate } from '../src/db/migrate'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { resolvers } from '../src/schema/resolvers'
import {
  getBoard as getBoardRow,
  getColumn as getColumnRow,
  getCurrentUser,
  insertTask as insertTaskShared,
  makeCtx,
} from './helpers/fixtures'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DepRow = { task_id: string; blocker_id: string }

// ---------------------------------------------------------------------------
// Helpers (thin local wrappers over the shared `db` singleton)
// ---------------------------------------------------------------------------

const getBoard = () => getBoardRow(db)
const getColumn = (boardId: string) => getColumnRow(db, boardId)
const insertTask = (
  boardId: string,
  columnId: string,
  agentStatus: 'idle' | 'queued' | 'running' | 'blocked' = 'idle',
) => insertTaskShared(db, { boardId, columnId, agentStatus })

/** Insert a task with an explicit created_at timestamp for ordering tests. */
function _insertTaskAt(
  boardId: string,
  columnId: string,
  createdAt: string,
): string {
  const user = getCurrentUser(db)
  const id = generateId()
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, position, agent_status, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', 0, 'idle', ?, ?, ?, ?)`,
    [
      id,
      boardId,
      columnId,
      'Test Task',
      user.id,
      user.id,
      createdAt,
      createdAt,
    ],
  )
  return id
}

/** Insert a task with a specific parent_task_id. */
function insertSubtask(
  parentId: string,
  boardId: string,
  columnId: string,
  createdAt?: string,
): string {
  const user = getCurrentUser(db)
  const id = generateId()
  const _at = createdAt ?? "datetime('now')"
  if (createdAt) {
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, agent_status, parent_task_id, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', 0, 'idle', ?, ?, ?, ?, ?)`,
      [
        id,
        boardId,
        columnId,
        'Sub Task',
        parentId,
        user.id,
        user.id,
        createdAt,
        createdAt,
      ],
    )
  } else {
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, agent_status, parent_task_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, '', 0, 'idle', ?, ?, ?)`,
      [id, boardId, columnId, 'Sub Task', parentId, user.id, user.id],
    )
  }
  return id
}

function getEdge(taskId: string, blockerId: string): DepRow | null {
  return db
    .query(
      'SELECT task_id, blocker_id FROM task_dependencies WHERE task_id = ? AND blocker_id = ?',
    )
    .get(taskId, blockerId) as DepRow | null
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  createTables(db)
  seed(db)
  migrate(db)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Mutation.addTaskDependency', () => {
  test('happy path — returns task, edge exists in task_dependencies', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)
    const blockerId = insertTask(board.id, col.id)

    const task = resolvers.Mutation.addTaskDependency(
      {},
      { blockerId, taskId },
      makeCtx(db),
    )

    expect(task.id).toBe(taskId)

    const edge = getEdge(taskId, blockerId)
    expect(edge).not.toBeNull()
    expect(edge?.task_id).toBe(taskId)
    expect(edge?.blocker_id).toBe(blockerId)
  })

  test('self-edge throws DEPENDENCY_SELF', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    expect(() =>
      resolvers.Mutation.addTaskDependency(
        {},
        { blockerId: taskId, taskId },
        makeCtx(db),
      ),
    ).toThrow(GraphQLError)

    try {
      resolvers.Mutation.addTaskDependency(
        {},
        { blockerId: taskId, taskId },
        makeCtx(db),
      )
    } catch (err) {
      expect(err).toBeInstanceOf(GraphQLError)
      expect((err as GraphQLError).extensions.code).toBe('DEPENDENCY_SELF')
    }
  })

  test('cross-board throws DEPENDENCY_CROSS_BOARD', () => {
    const user = getCurrentUser(db)

    // Create a second board with its own column and task
    const board1 = getBoard()
    const col1 = getColumn(board1.id)
    const taskA = insertTask(board1.id, col1.id)

    const board2Id = generateId()
    db.run(`INSERT INTO boards (id, name, created_by) VALUES (?, ?, ?)`, [
      board2Id,
      'Second Board',
      user.id,
    ])
    const col2Id = generateId()
    db.run(
      `INSERT INTO columns (id, board_id, name, position) VALUES (?, ?, ?, ?)`,
      [col2Id, board2Id, 'Todo', 0],
    )
    const taskB = generateId()
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, agent_status, created_by, updated_by)
       VALUES (?, ?, ?, ?, '', 0, 'idle', ?, ?)`,
      [taskB, board2Id, col2Id, 'Task on board 2', user.id, user.id],
    )

    expect(() =>
      resolvers.Mutation.addTaskDependency(
        {},
        { blockerId: taskB, taskId: taskA },
        makeCtx(db),
      ),
    ).toThrow(GraphQLError)

    try {
      resolvers.Mutation.addTaskDependency(
        {},
        { blockerId: taskB, taskId: taskA },
        makeCtx(db),
      )
    } catch (err) {
      expect(err).toBeInstanceOf(GraphQLError)
      expect((err as GraphQLError).extensions.code).toBe(
        'DEPENDENCY_CROSS_BOARD',
      )
    }
  })

  test('cycle throws DEPENDENCY_CYCLE — A→B exists, adding B→A is rejected', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskA = insertTask(board.id, col.id)
    const taskB = insertTask(board.id, col.id)

    // Seed A→B edge (A depends on B)
    resolvers.Mutation.addTaskDependency(
      {},
      { blockerId: taskB, taskId: taskA },
      makeCtx(db),
    )

    // Trying B→A would create a cycle
    expect(() =>
      resolvers.Mutation.addTaskDependency(
        {},
        { blockerId: taskA, taskId: taskB },
        makeCtx(db),
      ),
    ).toThrow(GraphQLError)

    try {
      resolvers.Mutation.addTaskDependency(
        {},
        { blockerId: taskA, taskId: taskB },
        makeCtx(db),
      )
    } catch (err) {
      expect(err).toBeInstanceOf(GraphQLError)
      expect((err as GraphQLError).extensions.code).toBe('DEPENDENCY_CYCLE')
    }
  })
})

describe('Mutation.removeTaskDependency', () => {
  test('happy path — edge is gone after call', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)
    const blockerId = insertTask(board.id, col.id)

    // Seed the edge
    resolvers.Mutation.addTaskDependency({}, { blockerId, taskId }, makeCtx(db))
    expect(getEdge(taskId, blockerId)).not.toBeNull()

    // Remove it
    const task = resolvers.Mutation.removeTaskDependency(
      {},
      { blockerId, taskId },
      makeCtx(db),
    )

    expect(task.id).toBe(taskId)
    expect(getEdge(taskId, blockerId)).toBeNull()
  })
})

describe('Task.blockers field resolver', () => {
  test('returns blockers in add-order', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)
    const blockerA = insertTask(board.id, col.id)
    const blockerB = insertTask(board.id, col.id)
    const blockerC = insertTask(board.id, col.id)

    // Add in a specific order
    resolvers.Mutation.addTaskDependency(
      {},
      { blockerId: blockerA, taskId },
      makeCtx(db),
    )
    resolvers.Mutation.addTaskDependency(
      {},
      { blockerId: blockerB, taskId },
      makeCtx(db),
    )
    resolvers.Mutation.addTaskDependency(
      {},
      { blockerId: blockerC, taskId },
      makeCtx(db),
    )

    const blockers = resolvers.Task.blockers({ id: taskId } as never)
    expect(blockers).toHaveLength(3)
    expect(blockers[0]?.id).toBe(blockerA)
    expect(blockers[1]?.id).toBe(blockerB)
    expect(blockers[2]?.id).toBe(blockerC)
  })
})

describe('Task.dependents field resolver', () => {
  test('returns dependents of a blocker task', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const blockerId = insertTask(board.id, col.id)
    const dependentA = insertTask(board.id, col.id)
    const dependentB = insertTask(board.id, col.id)

    resolvers.Mutation.addTaskDependency(
      {},
      { blockerId, taskId: dependentA },
      makeCtx(db),
    )
    resolvers.Mutation.addTaskDependency(
      {},
      { blockerId, taskId: dependentB },
      makeCtx(db),
    )

    const dependents = resolvers.Task.dependents({ id: blockerId } as never)
    expect(dependents).toHaveLength(2)
    const ids = dependents.map((t: { id: string }) => t.id)
    expect(ids).toContain(dependentA)
    expect(ids).toContain(dependentB)
  })
})

describe('Task.subtasks field resolver', () => {
  test('returns children ordered by created_at ASC', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const parentId = insertTask(board.id, col.id)

    // Insert two subtasks with explicit timestamps so ordering is deterministic
    const child1 = insertSubtask(
      parentId,
      board.id,
      col.id,
      '2025-01-01 00:00:00',
    )
    const child2 = insertSubtask(
      parentId,
      board.id,
      col.id,
      '2025-01-02 00:00:00',
    )

    const subtasks = resolvers.Task.subtasks({ id: parentId } as never)
    expect(subtasks).toHaveLength(2)
    expect(subtasks[0]?.id).toBe(child1)
    expect(subtasks[1]?.id).toBe(child2)
  })
})
