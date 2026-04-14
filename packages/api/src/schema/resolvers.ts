import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { GraphQLError } from 'graphql'
import { z } from 'zod/v4'
import type { AuthContext } from '../auth'
import {
  createInvitation,
  listInvitations,
  requireAuth,
  requireSuperAdmin,
  revokeSessionsForUser,
} from '../auth'
import { isLocalRequest } from '../auth/local'
import { db, generateId } from '../db'
import { getOrchestrator } from '../orchestrator'
import { pubsub } from '../pubsub'
import { cleanupUnusedImages } from '../routes/images'
import { getUploadDir } from '../routes/uploadDir'
import { HexColorSchema } from './validation'

// ---------------------------------------------------------------------------
// Row types (snake_case from SQLite)
// ---------------------------------------------------------------------------

type UserRow = {
  id: string
  username: string
  display_name: string
  role: string
  github_id: string | null
  github_username: string | null
  revoked_at: string | null
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
  agent_instruction: string | null
  target_repo: string | null
  target_branch: string | null
  agent_status: string
  queue_after: string | null
  agent_output: string | null
  agent_error: string | null
  retry_count: number
  pr_url: string | null
  archived: number
  archived_at: string | null
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

/** Convert a lowercase DB action value to uppercase GraphQL enum value. */
function actionToEnum(action: string | null): string | null {
  if (!action) return null
  return action.toUpperCase()
}

/** Convert an uppercase GraphQL enum value to lowercase DB action value. */
function enumToAction(enumVal: string | null): string | null {
  if (!enumVal) return null
  return enumVal.toLowerCase()
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

type ResolverContext = AuthContext & { request?: Request }

function mapUser(row: UserRow) {
  return {
    createdAt: row.created_at,
    displayName: row.display_name,
    githubId: row.github_id,
    githubUsername: row.github_username,
    id: row.id,
    revokedAt: row.revoked_at,
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
    action: actionToEnum(row.action),
    agentInstruction: row.agent_instruction,
    agentStatus: row.agent_status.toUpperCase(),
    archived: Boolean(row.archived),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
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

  Invitation: {
    createdBy(invitation: { _createdBy: string }) {
      return getUserById(invitation._createdBy)
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
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      const user = { id: authUser.id }

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

    archiveTask(_: unknown, { id }: { id: string }, ctx: ResolverContext) {
      const authUser = requireAuth(ctx)
      const user = { id: authUser.id }

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

    async cancelAgent(
      _: unknown,
      { taskId }: { taskId: string },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      const user = { id: authUser.id }

      // Abort the running agent process if any
      const orchestrator = getOrchestrator()
      if (orchestrator) {
        await orchestrator.cancelTask(taskId)
      }

      // Atomic update: only cancel if the task is currently in a cancellable state.
      // This prevents a race where a poll re-queues the agent between a read and write.
      const result = db.run(
        `UPDATE tasks SET agent_status = 'idle', action = NULL, updated_by = ?, updated_at = datetime('now') WHERE id = ? AND agent_status IN ('running', 'queued', 'failed')`,
        [user.id, taskId],
      )

      if (result.changes === 0) {
        // Task was not in a cancellable state (already idle/failed/etc.) — return current state
        const task = getTaskById(taskId)
        if (!task) throw new Error(`Task ${taskId} not found`)
        return task
      }

      // Record the status_changed event — we know the previous status was 'running' or 'queued'
      db.run(
        'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
        [
          generateId(),
          taskId,
          user.id,
          'status_changed',
          JSON.stringify({ from: 'cancelled', to: 'idle' }),
        ],
      )

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

    createBoard(_: unknown, { name }: { name: string }, ctx: ResolverContext) {
      const authUser = requireSuperAdmin(ctx)
      const user = { id: authUser.id }
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
      ctx: ResolverContext,
    ) {
      requireAuth(ctx)
      const color = input.color ?? '#aaaaaa' // default to a light gray

      try {
        HexColorSchema.parse(color)
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new GraphQLError(
            `Invalid color: ${err.issues[0]?.message ?? 'invalid format'}`,
            { extensions: { code: 'BAD_USER_INPUT' } },
          )
        }
        throw err
      }

      const id = generateId()
      db.run(
        'INSERT INTO tags (id, board_id, name, color) VALUES (?, ?, ?, ?)',
        [id, input.boardId, input.name, color],
      )
      const row = db.query('SELECT * FROM tags WHERE id = ?').get(id) as TagRow
      return mapTag(row)
    },

    async createTask(
      _: unknown,
      {
        input,
      }: {
        input: {
          boardId: string
          columnId?: string | null
          title: string
          body?: string | null
          agentInstruction?: string | null
          targetRepo?: string | null
          targetBranch?: string | null
          tagIds?: string[] | null
          sessionId?: string | null
        }
      },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      const user = { id: authUser.id }

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
          `INSERT INTO tasks (id, board_id, column_id, title, body, position, target_repo, target_branch, agent_instruction, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            input.boardId,
            columnId as string,
            input.title,
            input.body ?? '',
            position,
            input.targetRepo ?? null,
            input.targetBranch ?? 'main',
            input.agentInstruction ?? null,
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

      // Migrate temp uploads to permanent location
      if (input.sessionId) {
        const root = getUploadDir()
        const tmpDir = join(root, 'tmp', input.sessionId)
        const permDir = join(root, input.boardId, id)

        try {
          const tmpStat = await stat(tmpDir).catch(() => null)
          if (tmpStat?.isDirectory()) {
            await mkdir(permDir, { recursive: true })
            const files = await readdir(tmpDir)
            for (const file of files) {
              await rename(join(tmpDir, file), join(permDir, file))
            }

            // Rewrite body URLs
            const currentBody = (
              db.query('SELECT body FROM tasks WHERE id = ?').get(id) as {
                body: string
              }
            ).body
            if (currentBody.includes(`/api/images/tmp/${input.sessionId}/`)) {
              const newBody = currentBody.replaceAll(
                `/api/images/tmp/${input.sessionId}/`,
                `/api/images/${input.boardId}/${id}/`,
              )
              db.run('UPDATE tasks SET body = ? WHERE id = ?', [newBody, id])
            }

            // Cleanup empty temp directories
            await rm(join(root, 'tmp', input.sessionId), {
              force: true,
              recursive: true,
            })
          }
        } catch (err) {
          console.error('Failed to migrate temp uploads:', err)
        }
      }

      // Clean up uploaded images not referenced in the body
      const savedBody = (
        db.query('SELECT body FROM tasks WHERE id = ?').get(id) as {
          body: string
        }
      ).body
      await cleanupUnusedImages(input.boardId, id, savedBody).catch((err) =>
        console.error('Image cleanup error:', err),
      )

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

    deleteComment(_: unknown, { id }: { id: string }, ctx: ResolverContext) {
      const authUser = requireAuth(ctx)
      const user = { id: authUser.id }

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

    deleteTag(
      _: unknown,
      { id, boardId }: { id: string; boardId: string },
      ctx: ResolverContext,
    ) {
      requireAuth(ctx)
      const existing = db
        .query('SELECT * FROM tags WHERE id = ?')
        .get(id) as TagRow | null
      if (!existing) {
        throw new GraphQLError(`Tag ${id} not found`, {
          extensions: { code: 'NOT_FOUND' },
        })
      }
      if (existing.board_id !== boardId) {
        throw new GraphQLError(`Tag ${id} not found`, {
          extensions: { code: 'NOT_FOUND' },
        })
      }

      db.run('DELETE FROM tags WHERE id = ?', [id])
      return true
    },

    generateInvitation(
      _: unknown,
      { githubUsername }: { githubUsername: string },
      ctx: ResolverContext,
    ) {
      const admin = requireSuperAdmin(ctx)

      // Validate GitHub username format (1-39 chars, alphanumeric or hyphens, no leading/trailing hyphens, no consecutive hyphens)
      const GITHUB_USERNAME_RE =
        /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/
      if (!GITHUB_USERNAME_RE.test(githubUsername)) {
        throw new GraphQLError(
          `Invalid GitHub username "${githubUsername}". GitHub usernames may only contain alphanumeric characters or hyphens, cannot begin or end with a hyphen, and must be 1-39 characters long.`,
          { extensions: { code: 'BAD_USER_INPUT' } },
        )
      }

      const result = createInvitation(githubUsername, admin.id)
      const row = db
        .query('SELECT * FROM invitations WHERE token = ?')
        .get(result.token) as {
        id: string
        token: string
        github_username: string
        created_by: string
        created_at: string
        expires_at: string
        used_at: string | null
      }
      return {
        _createdBy: row.created_by,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        githubUsername: row.github_username,
        id: row.id,
        token: row.token,
        usedAt: row.used_at,
      }
    },

    moveTask(
      _: unknown,
      {
        id,
        columnId,
        position,
      }: { id: string; columnId: string; position: number },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      const user = { id: authUser.id }

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
          const prev = siblings[i - 1]?.position ?? 0
          const curr = siblings[i]?.position ?? 0
          if (curr - prev < 1.0) {
            needsReindex = true
            break
          }
        }

        if (needsReindex) {
          for (let i = 0; i < siblings.length; i++) {
            db.run('UPDATE tasks SET position = ? WHERE id = ?', [
              (i + 1) * 1024,
              siblings[i]?.id ?? '',
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

    revokeUser(
      _: unknown,
      { userId }: { userId: string },
      ctx: ResolverContext,
    ) {
      requireSuperAdmin(ctx)

      const targetUser = db
        .query('SELECT * FROM users WHERE id = ?')
        .get(userId) as UserRow | null
      if (!targetUser) throw new Error(`User ${userId} not found`)
      if (targetUser.username === 'queen-bee') {
        throw new Error('Cannot revoke the queen-bee super-admin')
      }

      db.run("UPDATE users SET revoked_at = datetime('now') WHERE id = ?", [
        userId,
      ])
      // Invalidate all sessions for this user
      revokeSessionsForUser(userId)

      const updated = db
        .query('SELECT * FROM users WHERE id = ?')
        .get(userId) as UserRow
      return mapUser(updated)
    },

    async runAgent(
      _: unknown,
      {
        taskId,
        action,
        instruction,
      }: {
        taskId: string
        action: string
        instruction?: string | null
      },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      const user = { id: authUser.id }

      const existing = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(taskId) as TaskRow | null
      if (!existing) throw new Error(`Task ${taskId} not found`)

      if (
        existing.agent_status === 'running' ||
        existing.agent_status === 'queued'
      ) {
        throw new Error(
          `Cannot run agent: task is already ${existing.agent_status}`,
        )
      }

      const dbAction = enumToAction(action)
      const events: Array<[string, string, string | null]> = []

      const setClauses: string[] = [
        'action = ?',
        "agent_status = 'queued'",
        "queue_after = datetime('now', '+15 seconds')",
        'updated_by = ?',
        "updated_at = datetime('now')",
      ]
      const values: (string | number | null)[] = [dbAction, user.id]

      events.push([
        generateId(),
        'action_set',
        JSON.stringify({ action: dbAction }),
      ])
      events.push([
        generateId(),
        'status_changed',
        JSON.stringify({ from: existing.agent_status, to: 'queued' }),
      ])

      if (instruction !== undefined && instruction !== null) {
        setClauses.push('agent_instruction = ?')
        values.push(instruction)
      }

      values.push(taskId)

      db.transaction(() => {
        db.run(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`, values)
        for (const [eventId, type, data] of events) {
          db.run(
            'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
            [eventId, taskId, user.id, type, data],
          )
        }
      })()

      const task = getTaskById(taskId)
      if (!task) throw new Error(`Task ${taskId} not found`)
      publishTaskUpdated(task)

      // Publish task events
      for (const [eventId, type, data] of events) {
        pubsub.publish('TASK_EVENT', taskId, {
          _actor: user.id,
          createdAt: new Date().toISOString(),
          data,
          id: eventId,
          isSystem: false,
          type,
        } as unknown as Record<string, unknown>)
      }

      return task
    },

    setTaskTags(
      _: unknown,
      { taskId, tagIds }: { taskId: string; tagIds: string[] },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      const user = { id: authUser.id }
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

    unarchiveTask(_: unknown, { id }: { id: string }, ctx: ResolverContext) {
      const authUser = requireAuth(ctx)
      const user = { id: authUser.id }

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

    updateComment(
      _: unknown,
      { id, body }: { id: string; body: string },
      ctx: ResolverContext,
    ) {
      requireAuth(ctx)
      db.run(
        `UPDATE task_comments SET body = ?, updated_at = datetime('now') WHERE id = ?`,
        [body, id],
      )
      const row = db
        .query('SELECT * FROM task_comments WHERE id = ?')
        .get(id) as CommentRow
      const comment = mapComment(row)

      pubsub.publish(
        'COMMENT_UPDATED',
        row.task_id,
        comment as unknown as Record<string, unknown>,
      )

      return comment
    },

    async updateTask(
      _: unknown,
      {
        id,
        input,
      }: {
        id: string
        input: {
          title?: string | null
          body?: string | null
          agentInstruction?: string | null
          targetRepo?: string | null
          targetBranch?: string | null
          tagIds?: string[] | null
        }
      },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      const user = { id: authUser.id }
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

      if (input.agentInstruction !== undefined) {
        const newInstruction = input.agentInstruction ?? null
        if (newInstruction !== existing.agent_instruction) {
          setClauses.push('agent_instruction = ?')
          values.push(newInstruction)
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

      // Clean up uploaded images no longer referenced in the body
      if (input.body !== undefined) {
        const updatedBody = db
          .query('SELECT body, board_id FROM tasks WHERE id = ?')
          .get(id) as {
          body: string
          board_id: string
        }
        await cleanupUnusedImages(
          updatedBody.board_id,
          id,
          updatedBody.body,
        ).catch((err) => console.error('Image cleanup error:', err))
      }

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

    authConfig(_: unknown, __: unknown, ctx: ResolverContext) {
      const request = ctx.request
      return {
        githubOAuthClientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? null,
        isLocal: request ? isLocalRequest(request) : false,
      }
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

    invitations(_: unknown, __: unknown, ctx: ResolverContext) {
      requireSuperAdmin(ctx)
      const rows = listInvitations()
      return rows.map((row) => ({
        _createdBy: row.created_by,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        githubUsername: row.github_username,
        id: row.id,
        token: row.token,
        usedAt: row.used_at,
      }))
    },

    me(_: unknown, __: unknown, ctx: ResolverContext) {
      const authUser = requireAuth(ctx)
      return {
        createdAt: '',
        displayName: authUser.displayName,
        githubId: authUser.githubId,
        githubUsername: authUser.githubUsername,
        id: authUser.id,
        role: authUser.role,
        username: authUser.username,
      }
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

    users(_: unknown, __: unknown, ctx: ResolverContext) {
      requireSuperAdmin(ctx)
      const rows = db
        .query('SELECT * FROM users ORDER BY created_at ASC')
        .all() as UserRow[]
      return rows.map(mapUser)
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

    commentUpdated: {
      resolve(payload: Record<string, unknown>) {
        return payload
      },
      subscribe(_: unknown, { taskId }: { taskId: string }) {
        return pubsub.subscribe('COMMENT_UPDATED', taskId)
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
