import { db, generateId } from '../db'
import { getOrchestrator } from '../orchestrator'
import { pubsub } from '../pubsub'

// ---------------------------------------------------------------------------
// Row types (snake_case from SQLite)
// ---------------------------------------------------------------------------

type UserRow = {
  id: string
  username: string
  display_name: string
  role: string
  created_at: string
}

type BoardRow = {
  id: string
  name: string
  created_by: string
  created_at: string
  updated_at: string
}

type ColumnRow = {
  id: string
  board_id: string
  name: string
  position: number
  created_at: string
}

type TaskRow = {
  id: string
  board_id: string
  column_id: string
  title: string
  body: string
  position: number
  action: string | null
  target_repo: string | null
  target_branch: string | null
  agent_status: string
  agent_output: string | null
  agent_error: string | null
  retry_count: number
  pr_url: string | null
  pr_number: number | null
  archived: number
  archived_at: string | null
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

type CommentRow = {
  id: string
  task_id: string
  parent_id: string | null
  body: string
  created_by: string
  created_at: string
  updated_at: string
}

type TaskEventRow = {
  id: string
  task_id: string
  actor: string
  type: string
  data: string | null
  created_at: string
}

type AgentRunRow = {
  id: string
  task_id: string
  action: string
  status: string
  output: string | null
  error: string | null
  started_at: string
  finished_at: string | null
}

type TagRow = {
  id: string
  board_id: string
  name: string
  color: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentUser(): UserRow {
  const user = db
    .query('SELECT * FROM users WHERE username = ?')
    .get('queen-bee') as UserRow | null
  if (!user) throw new Error('Queen-bee user not found. Run migrations first.')
  return user
}

function mapUser(row: UserRow) {
  return {
    displayName: row.display_name,
    id: row.id,
    role: row.role,
    username: row.username,
  }
}

function getUserById(id: string) {
  const row = db
    .query('SELECT * FROM users WHERE id = ?')
    .get(id) as UserRow | null
  if (!row) return null
  return mapUser(row)
}

function mapTask(row: TaskRow) {
  return {
    ...row,
    // Keep raw references for field resolvers
    _columnId: row.column_id,
    _createdBy: row.created_by,
    _updatedBy: row.updated_by,
    agentError: row.agent_error,
    agentOutput: row.agent_output,
    agentStatus: row.agent_status.toUpperCase(),
    archived: Boolean(row.archived),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    retryCount: row.retry_count,
    targetBranch: row.target_branch,
    targetRepo: row.target_repo,
    updatedAt: row.updated_at,
  }
}

function mapComment(row: CommentRow) {
  return {
    _createdBy: row.created_by,
    _taskId: row.task_id,
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    parentId: row.parent_id,
    updatedAt: row.updated_at,
  }
}

function mapColumn(row: ColumnRow) {
  return {
    _boardId: row.board_id,
    id: row.id,
    name: row.name,
    position: row.position,
  }
}

function mapBoard(row: BoardRow) {
  return {
    _createdBy: row.created_by,
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
  }
}

function getColumnsForBoard(boardId: string) {
  const rows = db
    .query('SELECT * FROM columns WHERE board_id = ? ORDER BY position ASC')
    .all(boardId) as ColumnRow[]
  return rows.map(mapColumn)
}

function getTasksForColumn(columnId: string) {
  const rows = db
    .query(
      'SELECT * FROM tasks WHERE column_id = ? AND archived = 0 ORDER BY position ASC',
    )
    .all(columnId) as TaskRow[]
  return rows.map(mapTask)
}

function getTopLevelCommentsForTask(taskId: string) {
  const rows = db
    .query(
      'SELECT * FROM task_comments WHERE task_id = ? AND parent_id IS NULL ORDER BY created_at ASC',
    )
    .all(taskId) as CommentRow[]
  return rows.map(mapComment)
}

function getRepliesForComment(parentId: string) {
  const rows = db
    .query(
      'SELECT * FROM task_comments WHERE parent_id = ? ORDER BY created_at ASC',
    )
    .all(parentId) as CommentRow[]
  return rows.map(mapComment)
}

function mapTag(row: TagRow) {
  return { color: row.color, id: row.id, name: row.name }
}

function getTagsForTask(taskId: string) {
  const rows = db
    .query(
      'SELECT t.* FROM tags t INNER JOIN task_tags tt ON tt.tag_id = t.id WHERE tt.task_id = ? ORDER BY t.name ASC',
    )
    .all(taskId) as TagRow[]
  return rows.map(mapTag)
}

function getTagsForBoard(boardId: string) {
  const rows = db
    .query('SELECT * FROM tags WHERE board_id = ? ORDER BY name ASC')
    .all(boardId) as TagRow[]
  return rows.map(mapTag)
}

function setTaskTags(taskId: string, tagIds: string[]) {
  db.run('DELETE FROM task_tags WHERE task_id = ?', [taskId])
  for (const tagId of tagIds) {
    db.run('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)', [
      taskId,
      tagId,
    ])
  }
}

function getTaskById(id: string) {
  const row = db
    .query('SELECT * FROM tasks WHERE id = ?')
    .get(id) as TaskRow | null
  if (!row) return null
  return mapTask(row)
}

function publishTaskUpdated(task: ReturnType<typeof mapTask>) {
  const boardRow = db
    .query('SELECT board_id FROM tasks WHERE id = ?')
    .get(task.id) as { board_id: string } | null
  if (boardRow) {
    pubsub.publish(
      'TASK_UPDATED',
      boardRow.board_id,
      task as unknown as Record<string, unknown>,
    )
  }
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

export const resolvers = {
  // -------------------------------------------------------------------------
  // Field resolvers
  // -------------------------------------------------------------------------

  Board: {
    columns(board: ReturnType<typeof mapBoard>) {
      return getColumnsForBoard(board.id)
    },
    createdBy(board: ReturnType<typeof mapBoard>) {
      return getUserById(board._createdBy)
    },
    tags(board: ReturnType<typeof mapBoard>) {
      return getTagsForBoard(board.id)
    },
  },

  Column: {
    tasks(column: ReturnType<typeof mapColumn>) {
      return getTasksForColumn(column.id)
    },
  },

  Comment: {
    createdBy(comment: ReturnType<typeof mapComment>) {
      return getUserById(comment._createdBy)
    },
    replies(comment: ReturnType<typeof mapComment>) {
      return getRepliesForComment(comment.id)
    },
  },

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  Mutation: {
    addComment(
      _: unknown,
      {
        taskId,
        body,
        parentId,
      }: { taskId: string; body: string; parentId?: string | null },
    ) {
      const user = getCurrentUser()

      if (parentId) {
        const parent = db
          .query('SELECT parent_id FROM task_comments WHERE id = ?')
          .get(parentId) as { parent_id: string | null } | null
        if (!parent) throw new Error(`Parent comment ${parentId} not found`)
        if (parent.parent_id !== null) {
          throw new Error('Cannot nest replies more than 1 level deep')
        }
      }

      const id = generateId()

      db.transaction(() => {
        db.run(
          'INSERT INTO task_comments (id, task_id, parent_id, body, created_by) VALUES (?, ?, ?, ?, ?)',
          [id, taskId, parentId ?? null, body, user.id],
        )
        db.run(
          'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
          [
            generateId(),
            taskId,
            user.id,
            'comment_added',
            JSON.stringify({ comment_id: id }),
          ],
        )
      })()

      const row = db
        .query('SELECT * FROM task_comments WHERE id = ?')
        .get(id) as CommentRow
      const comment = mapComment(row)

      pubsub.publish(
        'COMMENT_ADDED',
        taskId,
        comment as unknown as Record<string, unknown>,
      )

      // Publish TASK_EVENT for the 'comment_added' event
      const commentEvent = db
        .query(
          `SELECT * FROM task_events WHERE task_id = ? AND type = 'comment_added' ORDER BY created_at DESC LIMIT 1`,
        )
        .get(taskId) as {
        id: string
        type: string
        data: string | null
        created_at: string
        actor: string
      } | null
      if (commentEvent) {
        pubsub.publish('TASK_EVENT', taskId, {
          _actor: commentEvent.actor,
          createdAt: commentEvent.created_at,
          data: commentEvent.data,
          id: commentEvent.id,
          isSystem: false,
          type: commentEvent.type,
        } as unknown as Record<string, unknown>)
      }

      return comment
    },

    archiveTask(_: unknown, { id }: { id: string }) {
      const user = getCurrentUser()

      db.transaction(() => {
        db.run(
          `UPDATE tasks SET archived = 1, archived_at = datetime('now'), updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
          [user.id, id],
        )
        db.run(
          'INSERT INTO task_events (id, task_id, actor, type) VALUES (?, ?, ?, ?)',
          [generateId(), id, user.id, 'archived'],
        )
      })()

      const task = getTaskById(id)
      if (!task) throw new Error(`Task ${id} not found`)
      publishTaskUpdated(task)

      // Publish TASK_EVENT for the 'archived' event
      const archivedEvent = db
        .query(
          `SELECT * FROM task_events WHERE task_id = ? AND type = 'archived' ORDER BY created_at DESC LIMIT 1`,
        )
        .get(id) as {
        id: string
        type: string
        data: string | null
        created_at: string
        actor: string
      } | null
      if (archivedEvent) {
        pubsub.publish('TASK_EVENT', id, {
          _actor: archivedEvent.actor,
          createdAt: archivedEvent.created_at,
          data: archivedEvent.data,
          id: archivedEvent.id,
          isSystem: false,
          type: archivedEvent.type,
        } as unknown as Record<string, unknown>)
      }

      return task
    },

    async cancelAgent(_: unknown, { taskId }: { taskId: string }) {
      const user = getCurrentUser()

      // Read the current agent_status before updating
      const currentTaskRow = db
        .query('SELECT agent_status FROM tasks WHERE id = ?')
        .get(taskId) as { agent_status: string } | null
      const currentStatus = currentTaskRow?.agent_status ?? 'idle'

      // Abort the running agent process if any
      const orchestrator = getOrchestrator()
      if (orchestrator) {
        await orchestrator.cancelTask(taskId)
      }

      db.transaction(() => {
        db.run(
          `UPDATE tasks SET agent_status = 'idle', updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
          [user.id, taskId],
        )
        db.run(
          'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
          [
            generateId(),
            taskId,
            user.id,
            'status_changed',
            JSON.stringify({ from: currentStatus, to: 'idle' }),
          ],
        )
      })()

      const task = getTaskById(taskId)
      if (!task) throw new Error(`Task ${taskId} not found`)
      publishTaskUpdated(task)

      // Publish TASK_EVENT for the 'status_changed' event (cancel → idle)
      const cancelEvent = db
        .query(
          `SELECT * FROM task_events WHERE task_id = ? AND type = 'status_changed' ORDER BY created_at DESC LIMIT 1`,
        )
        .get(taskId) as {
        id: string
        type: string
        data: string | null
        created_at: string
        actor: string
      } | null
      if (cancelEvent) {
        pubsub.publish('TASK_EVENT', taskId, {
          _actor: cancelEvent.actor,
          createdAt: cancelEvent.created_at,
          data: cancelEvent.data,
          id: cancelEvent.id,
          isSystem: false,
          type: cancelEvent.type,
        } as unknown as Record<string, unknown>)
      }

      return task
    },
    createBoard(_: unknown, { name }: { name: string }) {
      const user = getCurrentUser()
      const id = generateId()
      db.run('INSERT INTO boards (id, name, created_by) VALUES (?, ?, ?)', [
        id,
        name,
        user.id,
      ])
      const row = db
        .query('SELECT * FROM boards WHERE id = ?')
        .get(id) as BoardRow
      return mapBoard(row)
    },

    createTag(
      _: unknown,
      {
        input,
      }: {
        input: { boardId: string; name: string; color?: string | null }
      },
    ) {
      const color = input.color ?? '#aaaaaa' // default to a light gray

      const id = generateId()
      db.run(
        'INSERT INTO tags (id, board_id, name, color) VALUES (?, ?, ?, ?)',
        [id, input.boardId, input.name, color],
      )
      const row = db.query('SELECT * FROM tags WHERE id = ?').get(id) as TagRow
      return mapTag(row)
    },

    createTask(
      _: unknown,
      {
        input,
      }: {
        input: {
          boardId: string
          columnId?: string | null
          title: string
          body?: string | null
          action?: string | null
          targetRepo?: string | null
          targetBranch?: string | null
          tagIds?: string[] | null
        }
      },
    ) {
      const user = getCurrentUser()

      // Resolve columnId — default to first column of board if not provided
      let columnId = input.columnId
      if (!columnId) {
        const col = db
          .query(
            'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
          )
          .get(input.boardId) as { id: string } | null
        if (!col) throw new Error('Board has no columns')
        columnId = col.id
      }

      // Determine position
      const maxRow = db
        .query('SELECT MAX(position) as max_pos FROM tasks WHERE column_id = ?')
        .get(columnId) as { max_pos: number | null }
      const position = maxRow.max_pos !== null ? maxRow.max_pos + 1024 : 0

      const id = generateId()

      db.transaction(() => {
        db.run(
          `INSERT INTO tasks (id, board_id, column_id, title, body, position, action, target_repo, target_branch, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            input.boardId,
            columnId as string,
            input.title,
            input.body ?? '',
            position,
            input.action ?? null,
            input.targetRepo ?? null,
            input.targetBranch ?? 'main',
            user.id,
            user.id,
          ],
        )

        db.run(
          'INSERT INTO task_events (id, task_id, actor, type) VALUES (?, ?, ?, ?)',
          [generateId(), id, user.id, 'created'],
        )

        if (input.tagIds?.length) {
          setTaskTags(id, input.tagIds)
        }
      })()

      const task = getTaskById(id)
      if (!task) throw new Error(`Task ${id} not found`)

      // Publish subscription events
      const boardRow = db
        .query('SELECT board_id FROM tasks WHERE id = ?')
        .get(id) as { board_id: string }
      pubsub.publish(
        'TASK_UPDATED',
        boardRow.board_id,
        task as unknown as Record<string, unknown>,
      )

      // Publish the 'created' task event
      const createdEvent = db
        .query(
          `SELECT * FROM task_events WHERE task_id = ? AND type = 'created' ORDER BY created_at DESC LIMIT 1`,
        )
        .get(id) as {
        id: string
        type: string
        data: string | null
        created_at: string
        actor: string
      } | null
      if (createdEvent) {
        pubsub.publish('TASK_EVENT', id, {
          _actor: createdEvent.actor,
          createdAt: createdEvent.created_at,
          data: createdEvent.data,
          id: createdEvent.id,
          isSystem: false,
          type: createdEvent.type,
        } as unknown as Record<string, unknown>)
      }

      return task
    },

    deleteComment(_: unknown, { id }: { id: string }) {
      const user = getCurrentUser()

      // Fetch comment before deletion for task_id
      const existing = db
        .query('SELECT * FROM task_comments WHERE id = ?')
        .get(id) as CommentRow | null
      if (!existing) throw new Error(`Comment ${id} not found`)

      const eventId = generateId()

      db.transaction(() => {
        db.run(
          'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
          [
            eventId,
            existing.task_id,
            user.id,
            'comment_deleted',
            JSON.stringify({ comment_id: id }),
          ],
        )
        db.run('DELETE FROM task_comments WHERE id = ?', [id])
      })()

      // Publish TASK_EVENT for the deletion
      const ev = db
        .query('SELECT * FROM task_events WHERE id = ?')
        .get(eventId) as {
        id: string
        type: string
        data: string | null
        created_at: string
        actor: string
      } | null
      if (ev) {
        pubsub.publish('TASK_EVENT', existing.task_id, {
          _actor: ev.actor,
          createdAt: ev.created_at,
          data: ev.data,
          id: ev.id,
          isSystem: false,
          type: ev.type,
        } as unknown as Record<string, unknown>)
      }

      return true
    },

    deleteTag(_: unknown, { id }: { id: string }) {
      db.run('DELETE FROM tags WHERE id = ?', [id])
      return true
    },

    dispatchAgent(
      _: unknown,
      { taskId, action }: { taskId: string; action: string },
    ) {
      const user = getCurrentUser()

      // Validate action is one of the allowed values
      const validActions = [
        'idle',
        'plan',
        'research',
        'implement',
        'implement-e2e',
        'revise',
      ]
      if (!validActions.includes(action)) {
        throw new Error(
          `Invalid action '${action}'. Must be one of: ${validActions.join(', ')}`,
        )
      }

      // Fetch task and validate preconditions
      const existingTask = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(taskId) as TaskRow | null
      if (!existingTask) throw new Error(`Task ${taskId} not found`)

      if (
        existingTask.agent_status !== 'idle' &&
        existingTask.agent_status !== 'failed'
      ) {
        throw new Error(
          `Cannot dispatch agent: task is currently '${existingTask.agent_status}'. Must be 'idle' or 'failed'.`,
        )
      }

      if (
        action === 'implement' ||
        action === 'implement-e2e' ||
        action === 'revise'
      ) {
        if (!existingTask.target_repo) {
          throw new Error(
            `Action '${action}' requires target_repo to be set on the task.`,
          )
        }
      }

      db.transaction(() => {
        db.run(
          `UPDATE tasks SET action = ?, agent_status = 'queued', updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
          [action, user.id, taskId],
        )
        db.run(
          'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
          [
            generateId(),
            taskId,
            user.id,
            'action_set',
            JSON.stringify({ action }),
          ],
        )
        db.run(
          'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
          [
            generateId(),
            taskId,
            user.id,
            'status_changed',
            JSON.stringify({ from: 'idle', to: 'queued' }),
          ],
        )
      })()

      const task = getTaskById(taskId)
      if (!task) throw new Error(`Task ${taskId} not found`)
      publishTaskUpdated(task)

      // Publish TASK_EVENTs for the action_set + status_changed events
      const dispatchEvents = db
        .query(
          `SELECT * FROM task_events WHERE task_id = ? AND type IN ('action_set', 'status_changed') ORDER BY created_at DESC LIMIT 2`,
        )
        .all(taskId) as Array<{
        id: string
        type: string
        data: string | null
        created_at: string
        actor: string
      }>
      for (const ev of dispatchEvents) {
        pubsub.publish('TASK_EVENT', taskId, {
          _actor: ev.actor,
          createdAt: ev.created_at,
          data: ev.data,
          id: ev.id,
          isSystem: false,
          type: ev.type,
        } as unknown as Record<string, unknown>)
      }

      return task
    },

    moveTask(
      _: unknown,
      {
        id,
        columnId,
        position,
      }: { id: string; columnId: string; position: number },
    ) {
      const user = getCurrentUser()

      // Look up the old column name before the update
      const oldColumnRow = db
        .query(
          'SELECT c.name FROM columns c INNER JOIN tasks t ON t.column_id = c.id WHERE t.id = ?',
        )
        .get(id) as { name: string } | null
      const fromColumnName = oldColumnRow?.name ?? null

      db.transaction(() => {
        db.run(
          `UPDATE tasks SET column_id = ?, position = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
          [columnId, position, user.id, id],
        )

        // Check if re-indexing is needed (gap < 1.0 between adjacent tasks)
        const siblings = db
          .query(
            'SELECT id, position FROM tasks WHERE column_id = ? AND archived = 0 ORDER BY position ASC',
          )
          .all(columnId) as Array<{ id: string; position: number }>

        let needsReindex = false
        for (let i = 1; i < siblings.length; i++) {
          const gap = siblings[i]?.position - siblings[i - 1]?.position
          if (gap < 1.0) {
            needsReindex = true
            break
          }
        }

        if (needsReindex) {
          for (let i = 0; i < siblings.length; i++) {
            db.run('UPDATE tasks SET position = ? WHERE id = ?', [
              (i + 1) * 1024,
              siblings[i]?.id,
            ])
          }
        }

        // Look up the new column name after the update
        const newColumnRow = db
          .query('SELECT name FROM columns WHERE id = ?')
          .get(columnId) as { name: string } | null
        const toColumnName = newColumnRow?.name ?? null

        db.run(
          'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
          [
            generateId(),
            id,
            user.id,
            'moved',
            JSON.stringify({
              from_column: fromColumnName,
              to_column: toColumnName,
            }),
          ],
        )
      })()

      const task = getTaskById(id)
      if (!task) throw new Error(`Task ${id} not found`)
      publishTaskUpdated(task)

      // Publish TASK_EVENT for the 'moved' event
      const movedEvent = db
        .query(
          `SELECT * FROM task_events WHERE task_id = ? AND type = 'moved' ORDER BY created_at DESC LIMIT 1`,
        )
        .get(id) as {
        id: string
        type: string
        data: string | null
        created_at: string
        actor: string
      } | null
      if (movedEvent) {
        pubsub.publish('TASK_EVENT', id, {
          _actor: movedEvent.actor,
          createdAt: movedEvent.created_at,
          data: movedEvent.data,
          id: movedEvent.id,
          isSystem: false,
          type: movedEvent.type,
        } as unknown as Record<string, unknown>)
      }

      return task
    },

    setTaskTags(
      _: unknown,
      { taskId, tagIds }: { taskId: string; tagIds: string[] },
    ) {
      const user = getCurrentUser()
      const existing = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(taskId) as TaskRow | null
      if (!existing) throw new Error(`Task ${taskId} not found`)

      const eventId = generateId()

      db.transaction(() => {
        setTaskTags(taskId, tagIds)
        db.run(
          `UPDATE tasks SET updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
          [user.id, taskId],
        )
        db.run(
          'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
          [
            eventId,
            taskId,
            user.id,
            'tags_changed',
            JSON.stringify({ tagIds }),
          ],
        )
      })()

      const task = getTaskById(taskId)
      if (!task) throw new Error(`Task ${taskId} not found`)
      publishTaskUpdated(task)

      const ev = db
        .query('SELECT * FROM task_events WHERE id = ?')
        .get(eventId) as {
        id: string
        type: string
        data: string | null
        created_at: string
        actor: string
      } | null
      if (ev) {
        pubsub.publish('TASK_EVENT', taskId, {
          _actor: ev.actor,
          createdAt: ev.created_at,
          data: ev.data,
          id: ev.id,
          isSystem: false,
          type: ev.type,
        } as unknown as Record<string, unknown>)
      }

      return task
    },

    unarchiveTask(_: unknown, { id }: { id: string }) {
      const user = getCurrentUser()

      db.transaction(() => {
        db.run(
          `UPDATE tasks SET archived = 0, archived_at = NULL, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
          [user.id, id],
        )
        db.run(
          'INSERT INTO task_events (id, task_id, actor, type) VALUES (?, ?, ?, ?)',
          [generateId(), id, user.id, 'unarchived'],
        )
      })()

      const task = getTaskById(id)
      if (!task) throw new Error(`Task ${id} not found`)
      publishTaskUpdated(task)

      // Publish TASK_EVENT for the 'unarchived' event
      const unarchivedEvent = db
        .query(
          `SELECT * FROM task_events WHERE task_id = ? AND type = 'unarchived' ORDER BY created_at DESC LIMIT 1`,
        )
        .get(id) as {
        id: string
        type: string
        data: string | null
        created_at: string
        actor: string
      } | null
      if (unarchivedEvent) {
        pubsub.publish('TASK_EVENT', id, {
          _actor: unarchivedEvent.actor,
          createdAt: unarchivedEvent.created_at,
          data: unarchivedEvent.data,
          id: unarchivedEvent.id,
          isSystem: false,
          type: unarchivedEvent.type,
        } as unknown as Record<string, unknown>)
      }

      return task
    },

    updateComment(_: unknown, { id, body }: { id: string; body: string }) {
      db.run(
        `UPDATE task_comments SET body = ?, updated_at = datetime('now') WHERE id = ?`,
        [body, id],
      )
      const row = db
        .query('SELECT * FROM task_comments WHERE id = ?')
        .get(id) as CommentRow
      const comment = mapComment(row)

      pubsub.publish(
        'COMMENT_ADDED',
        row.task_id,
        comment as unknown as Record<string, unknown>,
      )

      return comment
    },

    updateTask(
      _: unknown,
      {
        id,
        input,
      }: {
        id: string
        input: {
          title?: string | null
          body?: string | null
          action?: string | null
          targetRepo?: string | null
          targetBranch?: string | null
          tagIds?: string[] | null
        }
      },
    ) {
      const user = getCurrentUser()
      const existing = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(id) as TaskRow | null
      if (!existing) throw new Error(`Task ${id} not found`)

      const events: Array<[string, string, string | null]> = []

      const setClauses: string[] = [
        'updated_by = ?',
        "updated_at = datetime('now')",
      ]
      const values: (string | number | null | boolean)[] = [user.id]

      if (
        input.title !== undefined &&
        input.title !== null &&
        input.title !== existing.title
      ) {
        setClauses.push('title = ?')
        values.push(input.title)
        events.push([
          generateId(),
          'title_changed',
          JSON.stringify({ from: existing.title, to: input.title }),
        ])
      }

      if (
        input.body !== undefined &&
        input.body !== null &&
        input.body !== existing.body
      ) {
        setClauses.push('body = ?')
        values.push(input.body)
        events.push([generateId(), 'body_changed', null])
      }

      if (input.action !== undefined) {
        const newAction = input.action ?? null
        if (newAction !== existing.action) {
          setClauses.push('action = ?')
          values.push(newAction)
          events.push([
            generateId(),
            newAction ? 'action_set' : 'action_cleared',
            newAction ? JSON.stringify({ action: newAction }) : null,
          ])
        }
      }

      if (input.targetRepo !== undefined) {
        const newRepo = input.targetRepo ?? null
        if (newRepo !== existing.target_repo) {
          setClauses.push('target_repo = ?')
          values.push(newRepo)
        }
      }

      if (input.targetBranch !== undefined) {
        const newBranch = input.targetBranch ?? null
        if (newBranch !== existing.target_branch) {
          setClauses.push('target_branch = ?')
          values.push(newBranch)
        }
      }

      values.push(id)

      db.transaction(() => {
        db.run(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`, values)
        for (const [eventId, type, data] of events) {
          db.run(
            'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
            [eventId, id, user.id, type, data],
          )
        }

        if (input.tagIds !== undefined && input.tagIds !== null) {
          setTaskTags(id, input.tagIds)
          const tagEventId = generateId()
          events.push([
            tagEventId,
            'tags_changed',
            JSON.stringify({ tagIds: input.tagIds }),
          ])
          db.run(
            'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
            [
              tagEventId,
              id,
              user.id,
              'tags_changed',
              JSON.stringify({ tagIds: input.tagIds }),
            ],
          )
        }
      })()

      const task = getTaskById(id)
      if (!task) throw new Error(`Task ${id} not found`)
      publishTaskUpdated(task)

      // Publish TASK_EVENT for each change event recorded
      for (const [eventId] of events) {
        const ev = db
          .query('SELECT * FROM task_events WHERE id = ?')
          .get(eventId) as {
          id: string
          type: string
          data: string | null
          created_at: string
          actor: string
        } | null
        if (ev) {
          pubsub.publish('TASK_EVENT', id, {
            _actor: ev.actor,
            createdAt: ev.created_at,
            data: ev.data,
            id: ev.id,
            isSystem: false,
            type: ev.type,
          } as unknown as Record<string, unknown>)
        }
      }

      return task
    },
  },
  Query: {
    agentRuns(_: unknown, { taskId }: { taskId: string }) {
      const rows = db
        .query(
          'SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC',
        )
        .all(taskId) as AgentRunRow[]
      return rows.map((row) => ({
        action: row.action,
        error: row.error,
        finishedAt: row.finished_at,
        id: row.id,
        output: row.output,
        startedAt: row.started_at,
        status: row.status,
      }))
    },

    board(_: unknown, { id }: { id: string }) {
      const row = db
        .query('SELECT * FROM boards WHERE id = ?')
        .get(id) as BoardRow | null
      if (!row) return null
      return mapBoard(row)
    },
    boards() {
      const rows = db
        .query('SELECT * FROM boards ORDER BY created_at ASC')
        .all() as BoardRow[]
      return rows.map(mapBoard)
    },

    comments(_: unknown, { taskId }: { taskId: string }) {
      return getTopLevelCommentsForTask(taskId)
    },

    me() {
      return mapUser(getCurrentUser())
    },

    tags(_: unknown, { boardId }: { boardId: string }) {
      return getTagsForBoard(boardId)
    },

    task(_: unknown, { id }: { id: string }) {
      return getTaskById(id)
    },

    taskTimeline(_: unknown, { taskId }: { taskId: string }) {
      const rows = db
        .query(
          'SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC',
        )
        .all(taskId) as TaskEventRow[]
      return rows.map((row) => ({
        _actor: row.actor,
        createdAt: row.created_at,
        data: row.data,
        id: row.id,
        isSystem: row.actor === 'SYSTEM',
        type: row.type,
      }))
    },
  },

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  Subscription: {
    agentLogStream: {
      resolve(payload: Record<string, unknown>) {
        return payload
      },
      subscribe(_: unknown, { taskId }: { taskId: string }) {
        return pubsub.subscribe('AGENT_LOG', taskId)
      },
    },

    commentAdded: {
      resolve(payload: Record<string, unknown>) {
        return payload
      },
      subscribe(_: unknown, { taskId }: { taskId: string }) {
        return pubsub.subscribe('COMMENT_ADDED', taskId)
      },
    },

    taskEventAdded: {
      resolve(payload: Record<string, unknown>) {
        return payload
      },
      subscribe(_: unknown, { taskId }: { taskId: string }) {
        return pubsub.subscribe('TASK_EVENT', taskId)
      },
    },
    taskUpdated: {
      resolve(payload: Record<string, unknown>) {
        return payload
      },
      subscribe(_: unknown, { boardId }: { boardId: string }) {
        return pubsub.subscribe('TASK_UPDATED', boardId)
      },
    },
  },

  Task: {
    column(task: ReturnType<typeof mapTask>) {
      const row = db
        .query('SELECT * FROM columns WHERE id = ?')
        .get(task._columnId) as ColumnRow | null
      if (!row) throw new Error(`Column ${task._columnId} not found`)
      return mapColumn(row)
    },
    comments(task: ReturnType<typeof mapTask>) {
      return getTopLevelCommentsForTask(task.id)
    },
    createdBy(task: ReturnType<typeof mapTask>) {
      return getUserById(task._createdBy)
    },
    tags(task: ReturnType<typeof mapTask>) {
      return getTagsForTask(task.id)
    },
    updatedBy(task: ReturnType<typeof mapTask>) {
      return getUserById(task._updatedBy)
    },
  },

  TaskEvent: {
    actor(event: { _actor: string }) {
      if (event._actor === 'SYSTEM') return null
      return getUserById(event._actor)
    },
    isSystem(event: { isSystem: boolean }) {
      return event.isSystem
    },
  },
}
