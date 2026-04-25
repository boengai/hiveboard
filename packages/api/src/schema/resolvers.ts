import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { GraphQLError } from 'graphql'
import Mustache from 'mustache'
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
import { getConfig } from '../config'
import { VerifyCommandSchema } from '../config/schema'
import { db, generateId } from '../db'
import {
  addDependencyEdge,
  listBlockers,
  listDependents,
  removeDependencyEdge,
  sameBoard,
} from '../db/task-dependencies'
import {
  getCurrentQuestion,
  listMessagesForTask,
  type TaskMessageRow,
} from '../db/task-messages'
import { listCheckpointsForRun, countTurnsForRun } from '../db/checkpoints'
import { listVerificationRunsForTask } from '../db/verification-runs'
import {
  getSnapshotById,
  getSnapshotPatch,
  listSnapshotsForTask,
} from '../db/workspace-snapshots'
import { transition as taskLifecycleTransition } from '../lifecycle'
import { getOrchestrator } from '../orchestrator'
import { continueFailedTaskDb } from '../orchestrator/orchestrator'
import { wouldCreateCycle } from '../orchestrator/dependencies'
import * as commentService from '../services/comment-service'
import * as messageService from '../services/message-service'
import {
  archivePlaybook,
  createPlaybook,
  getPlaybookByName,
  listPlaybookVersions,
  listPlaybooks,
  type Playbook as PlaybookModel,
  PlaybookArchivedError,
  PlaybookNameTakenError,
  PlaybookNotFoundError,
  unarchivePlaybook,
  updatePlaybook,
} from '../playbooks'
import { mergePlaybookDefaultsIntoTask } from '../playbooks/merge-defaults'
import {
  publishScratchpadUpdated,
  publishTaskMissingSecretsChanged,
  pubsub,
} from '../pubsub'
import { cleanupUnusedImages } from '../routes/images'
import { getUploadDir } from '../routes/uploadDir'
import { progressPath, readScratchpad } from '../workspace/agent-state'
import { parseProgressLines } from '../workspace/progress-watcher'
import { watchScratchpad } from '../workspace/scratchpad-watcher'
import {
  HexColorSchema,
  PLAYBOOK_NAME_REGEX,
  VALID_TOOL_NAMES,
  validatePlaybookInput,
  validateTargetBranch,
  validateTargetRepo,
} from './validation'
import { secretsEnabled } from '../secrets/enabled'
import {
  computeMissingSecretNames,
  deleteBoardSecret as storeDeleteBoardSecret,
  deleteTaskSecret as storeDeleteTaskSecret,
  listBoardSecrets,
  listTaskSecrets,
  NAME_REGEX,
  parseRequiredSecrets,
  setBoardSecret as storeSetBoardSecret,
  setTaskSecret as storeSetTaskSecret,
} from '../secrets/store'

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
  parent_task_id: string | null
  time_box_ms: number | null
  time_box_started_at: string | null
  block_reason: string | null
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
    action: row.action,
    agentInstruction: row.agent_instruction,
    agentStatus: row.agent_status.toUpperCase(),
    archived: Boolean(row.archived),
    archivedAt: row.archived_at,
    blockReason: row.block_reason,
    createdAt: row.created_at,
    parentTaskId: row.parent_task_id,
    prUrl: row.pr_url,
    retryCount: row.retry_count,
    targetBranch: row.target_branch,
    targetRepo: row.target_repo,
    timeBoxMs: row.time_box_ms,
    timeBoxStartedAt: row.time_box_started_at,
    updatedAt: row.updated_at,
  }
}

function mapPlaybookVersion(v: {
  id: string
  versionNumber: number
  promptTemplate: string
  defaultsJson: string
  allowedToolsOverride: string[] | null
  createdBy: string
  createdAt: string
}) {
  return {
    _createdBy: v.createdBy,
    allowedToolsOverride: v.allowedToolsOverride,
    createdAt: v.createdAt,
    defaultsJson: v.defaultsJson,
    id: v.id,
    promptTemplate: v.promptTemplate,
    versionNumber: v.versionNumber,
  }
}

function mapPlaybook(pb: PlaybookModel) {
  return {
    _createdBy: pb.currentVersion.createdBy,
    archived: pb.archived,
    createdAt: pb.createdAt,
    currentVersion: mapPlaybookVersion(pb.currentVersion),
    description: pb.description,
    displayName: pb.displayName,
    id: pb.id,
    name: pb.name,
    playbookId: pb.id,
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

function mapTaskMessage(row: TaskMessageRow): {
  id: string
  taskId: string
  authorType: 'HUMAN' | 'AGENT'
  kind: 'HINT' | 'REDIRECT' | 'QUESTION' | 'ANSWER'
  body: string
  deliveredAt: string | null
  createdBy: string | null
  createdAt: string
  _createdBy: string | null
} {
  return {
    _createdBy: row.createdBy,
    authorType: row.authorType.toUpperCase() as 'HUMAN' | 'AGENT',
    body: row.body,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    deliveredAt: row.deliveredAt,
    id: row.id,
    kind: row.kind.toUpperCase() as 'HINT' | 'REDIRECT' | 'QUESTION' | 'ANSWER',
    taskId: row.taskId,
  }
}

function mapSnapshotRow(
  row: NonNullable<ReturnType<typeof getSnapshotById>>,
): Record<string, unknown> {
  let parsedFileStatus: unknown[] = []
  try {
    parsedFileStatus = JSON.parse(row.fileStatus) as unknown[]
  } catch {
    parsedFileStatus = []
  }
  return {
    agentRunId: row.agentRunId,
    capturedAt: row.capturedAt,
    fileStatus: parsedFileStatus,
    hasPatch: row.hasPatch,
    id: row.id,
    statSummary: row.statSummary,
    taskId: row.taskId,
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

/**
 * Authorization helpers.
 *
 * HiveBoard's ownership model: a board belongs to the user in `boards.created_by`.
 * Super-admins (role = 'super-admin') have god access — this keeps the local
 * queen-bee working as intended.
 *
 * Every board-scoped read or mutation must go through one of these helpers so a
 * caller cannot act on another user's board by guessing IDs. Missing rows throw
 * a NOT_FOUND error indistinguishable from the "board exists but you don't own
 * it" case, so an attacker cannot learn which IDs exist via timing/error shape.
 */

function notFound(kind: string, id: string): GraphQLError {
  return new GraphQLError(`${kind} ${id} not found`, {
    extensions: { code: 'NOT_FOUND' },
  })
}

function requireBoardAccess(
  boardId: string,
  user: { id: string; role: string },
): void {
  const row = db
    .query('SELECT created_by FROM boards WHERE id = ?')
    .get(boardId) as { created_by: string } | null
  if (!row) throw notFound('Board', boardId)
  if (user.role === 'super-admin') return
  if (row.created_by !== user.id) throw notFound('Board', boardId)
}

function requireSecretsEnabled(): void {
  if (!secretsEnabled()) {
    throw new GraphQLError(
      'Secrets feature is disabled (HIVEBOARD_SECRETS_KEY not set)',
      { extensions: { code: 'SECRETS_DISABLED' } },
    )
  }
}

function validateSecretName(name: string): void {
  if (!NAME_REGEX.test(name)) {
    throw new GraphQLError(
      `Invalid secret name: "${name}" — must match /^[A-Z_][A-Z0-9_]*$/`,
      { extensions: { code: 'SECRET_NAME_INVALID' } },
    )
  }
}

function validateSecretValue(value: string): void {
  if (value.length === 0) {
    throw new GraphQLError(
      'Secret value cannot be empty; use delete to remove',
      { extensions: { code: 'SECRET_VALUE_EMPTY' } },
    )
  }
  if (value.length < 6) {
    throw new GraphQLError(
      'Secret value must be at least 6 characters (shorter values would cause heavy collateral redaction of agent output)',
      { extensions: { code: 'SECRET_VALUE_TOO_SHORT' } },
    )
  }
}

function requireTaskAccess(
  taskId: string,
  user: { id: string; role: string },
): { boardId: string } {
  const row = db
    .query(
      'SELECT t.board_id as board_id, b.created_by as owner FROM tasks t INNER JOIN boards b ON b.id = t.board_id WHERE t.id = ?',
    )
    .get(taskId) as { board_id: string; owner: string } | null
  if (!row) throw notFound('Task', taskId)
  if (user.role !== 'super-admin' && row.owner !== user.id) {
    throw notFound('Task', taskId)
  }
  return { boardId: row.board_id }
}

function requireCommentAccess(
  commentId: string,
  user: { id: string; role: string },
): { taskId: string; authorId: string } {
  const row = db
    .query(
      'SELECT c.task_id as task_id, c.created_by as author, b.created_by as owner FROM task_comments c INNER JOIN tasks t ON t.id = c.task_id INNER JOIN boards b ON b.id = t.board_id WHERE c.id = ?',
    )
    .get(commentId) as { task_id: string; author: string; owner: string } | null
  if (!row) throw notFound('Comment', commentId)
  if (user.role !== 'super-admin' && row.owner !== user.id) {
    throw notFound('Comment', commentId)
  }
  return { authorId: row.author, taskId: row.task_id }
}

function requireTagAccess(
  tagId: string,
  user: { id: string; role: string },
): { boardId: string } {
  const row = db
    .query(
      'SELECT t.board_id as board_id, b.created_by as owner FROM tags t INNER JOIN boards b ON b.id = t.board_id WHERE t.id = ?',
    )
    .get(tagId) as { board_id: string; owner: string } | null
  if (!row) throw notFound('Tag', tagId)
  if (user.role !== 'super-admin' && row.owner !== user.id) {
    throw notFound('Tag', tagId)
  }
  return { boardId: row.board_id }
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

/**
 * After a secret change, walk every task affected by the changed name, recompute
 * missingSecrets, publish the change, and (if all now satisfied AND task is in
 * MISSING_SECRETS) transition to QUEUED with a 5-second grace window.
 *
 * Scope: if boardId given, scan every task on that board; if taskIdScope given,
 * scan only that task. Provide exactly one.
 */
function reResolveAfterSecretChange(
  changedName: string,
  opts: { boardId?: string; taskIdScope?: string },
): void {
  const rows = (opts.boardId
    ? db
        .query('SELECT id, required_secrets, agent_status, board_id FROM tasks WHERE board_id = ?')
        .all(opts.boardId)
    : db
        .query('SELECT id, required_secrets, agent_status, board_id FROM tasks WHERE id = ?')
        .all(opts.taskIdScope as string)
  ) as Array<{ id: string; required_secrets: string; agent_status: string; board_id: string }>

  for (const row of rows) {
    const required = parseRequiredSecrets(row.required_secrets)
    if (!required.includes(changedName)) continue

    const missing = computeMissingSecretNames(db, row.id)
    publishTaskMissingSecretsChanged(row.id, missing)

    if (row.agent_status === 'missing_secrets' && missing.length === 0) {
      taskLifecycleTransition({
        extras: (txDb) => {
          txDb.run(
            `UPDATE tasks SET agent_error = NULL, queue_after = datetime('now', '+5 seconds') WHERE id = ?`,
            [row.id],
          )
        },
        from: 'missing_secrets',
        taskId: row.id,
        to: 'queued',
      })
    }
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
    secrets(parent: { id: string }, _args: unknown, ctx: ResolverContext) {
      const user = requireAuth(ctx)
      // Belt-and-braces: Board.secrets must not leak even if a future upstream
      // resolver exposes a Board without access-checking. requireBoardAccess
      // throws notFound on non-owner non-super-admin — consistent with the
      // mutation paths above.
      requireBoardAccess(parent.id, user)
      if (!secretsEnabled()) return []
      const rows = listBoardSecrets(db, parent.id)
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        createdBy: { id: r.createdBy },
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))
    },
    tags(board: ReturnType<typeof mapBoard>) {
      return getTagsForBoard(board.id)
    },
  },

  BoardSecret: {
    createdBy(parent: { createdBy: { id: string } }) {
      return getUserById(parent.createdBy.id)
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

  AgentRun: {
    checkpoints(parent: { id: string }) {
      return listCheckpointsForRun(db, parent.id)
    },
    turnCount(parent: { id: string }) {
      return countTurnsForRun(db, parent.id)
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
      requireTaskAccess(taskId, authUser)
      try {
        return commentService.addComment({
          actorId: authUser.id,
          body,
          parentId,
          taskId,
        })
      } catch (e) {
        if (e instanceof commentService.CommentNotFoundError) {
          throw new Error(e.message)
        }
        if (e instanceof commentService.CommentDepthError) {
          throw new Error(e.message)
        }
        throw e
      }
    },

    addTaskDependency(
      _: unknown,
      { taskId, blockerId }: { taskId: string; blockerId: string },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)
      requireTaskAccess(blockerId, authUser)

      if (taskId === blockerId) {
        throw new GraphQLError('A task cannot depend on itself', {
          extensions: { code: 'DEPENDENCY_SELF' },
        })
      }
      if (!sameBoard(db, taskId, blockerId)) {
        throw new GraphQLError('Cross-board dependencies are not supported', {
          extensions: { code: 'DEPENDENCY_CROSS_BOARD' },
        })
      }
      if (wouldCreateCycle(db, taskId, blockerId)) {
        throw new GraphQLError('Adding this dependency would create a cycle', {
          extensions: { code: 'DEPENDENCY_CYCLE' },
        })
      }

      addDependencyEdge(db, taskId, blockerId)

      const row = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(taskId) as TaskRow | null
      if (!row) throw notFound('Task', taskId)
      const task = mapTask(row)
      publishTaskUpdated(task)
      return task
    },

    answerQuestion(
      _: unknown,
      { taskId, body }: { taskId: string; body: string },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)
      return messageService.answerQuestion({
        actorId: authUser.id,
        body,
        taskId,
      })
    },

    async archivePlaybook(
      _: unknown,
      { id }: { id: string },
      ctx: ResolverContext,
    ) {
      requireAuth(ctx)
      try {
        return mapPlaybook(archivePlaybook(db, id))
      } catch (e) {
        if (e instanceof PlaybookNotFoundError) {
          throw new GraphQLError(e.message, {
            extensions: { code: 'PLAYBOOK_NOT_FOUND' },
          })
        }
        throw e
      }
    },

    archiveTask(_: unknown, { id }: { id: string }, ctx: ResolverContext) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(id, authUser)
      const user = { id: authUser.id }

      db.transaction(() => {
        // Scratchpad dir is retained on archive; orphan sweep handles it only on hard delete.
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
      requireTaskAccess(taskId, authUser)
      const user = { id: authUser.id }

      // Abort the running agent process if any
      const orchestrator = getOrchestrator()
      if (orchestrator) {
        await orchestrator.cancelTask(taskId)
      }

      // Only cancel if currently in a cancellable state. The orchestrator
      // already aborted any running agent above; the lifecycle transition
      // serializes with the poll loop's transactions on the SQLite write
      // lock, so a race-free read happens inside `transition`.
      const current = db
        .query('SELECT agent_status FROM tasks WHERE id = ?')
        .get(taskId) as { agent_status: string } | null
      if (!current) throw new Error(`Task ${taskId} not found`)
      if (!['running', 'queued', 'failed'].includes(current.agent_status)) {
        const task = getTaskById(taskId)
        if (!task) throw new Error(`Task ${taskId} not found`)
        return task
      }

      taskLifecycleTransition({
        event: {
          actor: user.id,
          data: { from: 'cancelled', to: 'idle' },
          type: 'status_changed',
        },
        extras: (txDb) => {
          txDb.run(
            `UPDATE tasks SET action = NULL, updated_by = ? WHERE id = ?`,
            [user.id, taskId],
          )
        },
        taskId,
        to: 'idle',
      })

      const task = getTaskById(taskId)
      if (!task) throw new Error(`Task ${taskId} not found`)
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
      const authUser = requireAuth(ctx)
      requireBoardAccess(input.boardId, authUser)
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

    async createPlaybook(
      _: unknown,
      {
        input,
      }: {
        input: {
          name: string
          displayName: string
          description: string
          promptTemplate: string
          defaultsJson?: string | null
          allowedToolsOverride?: string[] | null
        }
      },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      const normalized = {
        allowedToolsOverride: input.allowedToolsOverride ?? null,
        defaultsJson: input.defaultsJson ?? '{}',
        description: input.description,
        displayName: input.displayName,
        name: input.name,
        promptTemplate: input.promptTemplate,
      }
      validatePlaybookInput(normalized)
      try {
        const pb = createPlaybook(db, {
          ...normalized,
          createdBy: authUser.id,
        })
        return mapPlaybook(pb)
      } catch (e) {
        if (e instanceof PlaybookNameTakenError) {
          throw new GraphQLError(e.message, {
            extensions: { code: 'PLAYBOOK_NAME_TAKEN' },
          })
        }
        throw e
      }
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
      requireBoardAccess(input.boardId, authUser)
      validateTargetRepo(input.targetRepo)
      validateTargetBranch(input.targetBranch)
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
      requireCommentAccess(id, authUser)
      try {
        return commentService.deleteComment({ actorId: authUser.id, id })
      } catch (e) {
        if (e instanceof commentService.CommentNotFoundError) {
          throw new Error(e.message)
        }
        throw e
      }
    },

    deleteTag(
      _: unknown,
      { id, boardId }: { id: string; boardId: string },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      const { boardId: tagBoardId } = requireTagAccess(id, authUser)
      if (tagBoardId !== boardId) throw notFound('Tag', id)

      db.run('DELETE FROM tags WHERE id = ?', [id])
      return true
    },

    async extendTimeBox(
      _: unknown,
      { taskId, additionalMs }: { taskId: string; additionalMs: number },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)
      if (additionalMs <= 0) {
        throw new GraphQLError('additionalMs must be positive', {
          extensions: { code: 'BAD_USER_INPUT' },
        })
      }
      const row = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(taskId) as TaskRow | null
      if (!row) throw notFound('Task', taskId)
      if (row.agent_status !== 'blocked' || row.block_reason !== 'TIMEOUT') {
        throw new GraphQLError(
          'extendTimeBox is only valid when task is BLOCKED with reason=TIMEOUT',
          { extensions: { code: 'TIME_BOX_NOT_EXPIRED' } },
        )
      }
      const newBudget = (row.time_box_ms ?? 0) + additionalMs
      taskLifecycleTransition({
        blockReason: null,
        extras: (txDb) => {
          txDb.run(
            `UPDATE tasks SET
               queue_after = datetime('now', '+5 seconds'),
               time_box_ms = ?,
               time_box_started_at = NULL
             WHERE id = ?`,
            [newBudget, taskId],
          )
        },
        from: 'blocked',
        taskId,
        to: 'queued',
      })
      const updated = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(taskId) as TaskRow
      return mapTask(updated)
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

    async killTask(
      _: unknown,
      { taskId }: { taskId: string },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)
      const orch = getOrchestrator()
      if (orch) await orch.killTask(taskId)
      const row = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(taskId) as TaskRow | null
      if (!row) throw notFound('Task', taskId)
      return mapTask(row)
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
      const { boardId } = requireTaskAccess(id, authUser)
      // Target column must belong to the same board to prevent cross-board moves
      const targetColumn = db
        .query('SELECT board_id FROM columns WHERE id = ?')
        .get(columnId) as { board_id: string } | null
      if (!targetColumn || targetColumn.board_id !== boardId) {
        throw notFound('Column', columnId)
      }
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

    removeTaskDependency(
      _: unknown,
      { taskId, blockerId }: { taskId: string; blockerId: string },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)

      removeDependencyEdge(db, taskId, blockerId)

      const row = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(taskId) as TaskRow | null
      if (!row) throw notFound('Task', taskId)
      const task = mapTask(row)
      publishTaskUpdated(task)
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
      requireTaskAccess(taskId, authUser)
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

      const dbAction = action

      let appliedPlaybookVersionId: string | null = null
      if (dbAction.startsWith('playbook:')) {
        const name = dbAction.slice('playbook:'.length)
        if (!PLAYBOOK_NAME_REGEX.test(name)) {
          throw new GraphQLError(`Invalid playbook name: ${name}`, {
            extensions: { code: 'BAD_USER_INPUT' },
          })
        }
        const pb = getPlaybookByName(db, name)
        if (!pb) {
          throw new GraphQLError(`Playbook not found: ${name}`, {
            extensions: { code: 'PLAYBOOK_NOT_FOUND' },
          })
        }
        if (pb.archived) {
          throw new GraphQLError(`Playbook is archived: ${name}`, {
            extensions: { code: 'PLAYBOOK_ARCHIVED' },
          })
        }
        appliedPlaybookVersionId = pb.currentVersion.id
        // Merge defaults BEFORE the UPDATE so the resolved values land on the task row.
        mergePlaybookDefaultsIntoTask(db, taskId, pb.currentVersion)
      }

      const events: Array<[string, string, string | null]> = []
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

      const setClauses: string[] = [
        'action = ?',
        "queue_after = datetime('now', '+15 seconds')",
        'verify_attempt_count = 0',
        'pending_auto_revise_source_run_id = NULL',
        'updated_by = ?',
      ]
      const values: (string | number | null)[] = [dbAction, user.id]

      if (instruction !== undefined && instruction !== null) {
        setClauses.push('agent_instruction = ?')
        values.push(instruction)
      }

      values.push(taskId)

      taskLifecycleTransition({
        extras: (txDb) => {
          txDb.run(
            `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`,
            values,
          )
          for (const [eventId, type, data] of events) {
            txDb.run(
              'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
              [eventId, taskId, user.id, type, data],
            )
          }
        },
        taskId,
        to: 'queued',
      })
      // `appliedPlaybookVersionId` is resolved by the orchestrator (insertAgentRun
      // looks it up again when the run row is created); we retain it here for
      // clarity/future use.
      void appliedPlaybookVersionId

      const task = getTaskById(taskId)
      if (!task) throw new Error(`Task ${taskId} not found`)

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

    async sendHint(
      _: unknown,
      { taskId, body }: { taskId: string; body: string },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)
      return messageService.sendHint({ actorId: authUser.id, body, taskId })
    },

    async sendRedirect(
      _: unknown,
      { taskId, body }: { taskId: string; body: string },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)
      return messageService.sendRedirect({
        actorId: authUser.id,
        body,
        taskId,
      })
    },

    continueFailedTask(
      _: unknown,
      { taskId, instruction }: { taskId: string; instruction?: string | null },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)
      continueFailedTaskDb(db, taskId, instruction ?? undefined)
      const row = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(taskId) as TaskRow | null
      if (!row) throw new GraphQLError('Task not found', { extensions: { code: 'NOT_FOUND' } })
      const task = mapTask(row)
      publishTaskUpdated(task)
      return task
    },

    setTaskTags(
      _: unknown,
      { taskId, tagIds }: { taskId: string; tagIds: string[] },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      const { boardId } = requireTaskAccess(taskId, authUser)
      const user = { id: authUser.id }
      const existing = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(taskId) as TaskRow | null
      if (!existing) throw new Error(`Task ${taskId} not found`)

      // Every tag must belong to the task's board — prevent cross-board tagging
      if (tagIds.length > 0) {
        const placeholders = tagIds.map(() => '?').join(',')
        const rows = db
          .query(
            `SELECT id FROM tags WHERE board_id = ? AND id IN (${placeholders})`,
          )
          .all(boardId, ...tagIds) as Array<{ id: string }>
        if (rows.length !== tagIds.length) {
          throw new GraphQLError(
            'One or more tags do not exist on this board',
            {
              extensions: { code: 'NOT_FOUND' },
            },
          )
        }
      }

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

    async setTaskVerifyCommands(
      _: unknown,
      {
        taskId,
        commands,
      }: {
        taskId: string
        commands: Array<{
          label: string
          run: string
          timeoutMs?: number | null
        }> | null
      },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)

      if (commands === null) {
        db.run(
          `UPDATE tasks SET verify_commands = NULL, updated_at = datetime('now') WHERE id = ?`,
          [taskId],
        )
      } else {
        // Validate against the same Zod schema the YAML config uses so both
        // paths reject empty labels/runs, non-positive timeouts, etc.
        const parsed = z.array(VerifyCommandSchema).parse(
          commands.map((c) => ({
            label: c.label,
            run: c.run,
            timeout_ms: c.timeoutMs ?? undefined,
          })),
        )
        const serialized = JSON.stringify(parsed)
        db.run(
          `UPDATE tasks SET verify_commands = ?, updated_at = datetime('now') WHERE id = ?`,
          [serialized, taskId],
        )
      }

      const row = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(taskId) as TaskRow
      return mapTask(row)
    },

    setBoardSecret(
      _: unknown,
      {
        boardId,
        name,
        value,
        description,
      }: {
        boardId: string
        name: string
        value: string
        description?: string | null
      },
      ctx: ResolverContext,
    ) {
      const user = requireAuth(ctx)
      requireSecretsEnabled()
      requireBoardAccess(boardId, user)
      validateSecretName(name)
      validateSecretValue(value)
      storeSetBoardSecret(db, {
        boardId,
        description: description ?? null,
        name,
        userId: user.id,
        value,
      })
      reResolveAfterSecretChange(name, { boardId })
      const row = listBoardSecrets(db, boardId).find((r) => r.name === name)
      if (!row) {
        throw new GraphQLError('Internal: board secret row missing after upsert', {
          extensions: { code: 'INTERNAL_ERROR' },
        })
      }
      return {
        createdAt: row.createdAt,
        createdBy: { id: row.createdBy },
        description: row.description,
        id: row.id,
        name: row.name,
        updatedAt: row.updatedAt,
      }
    },

    deleteBoardSecret(
      _: unknown,
      { boardId, name }: { boardId: string; name: string },
      ctx: ResolverContext,
    ) {
      const user = requireAuth(ctx)
      requireSecretsEnabled()
      requireBoardAccess(boardId, user)
      validateSecretName(name)
      storeDeleteBoardSecret(db, boardId, name)
      reResolveAfterSecretChange(name, { boardId })
      return true
    },

    setTaskSecret(
      _: unknown,
      { taskId, name, value }: { taskId: string; name: string; value: string },
      ctx: ResolverContext,
    ) {
      const user = requireAuth(ctx)
      requireSecretsEnabled()
      requireTaskAccess(taskId, user)
      validateSecretName(name)
      validateSecretValue(value)
      storeSetTaskSecret(db, { taskId, name, value, userId: user.id })
      reResolveAfterSecretChange(name, { taskIdScope: taskId })
      const row = listTaskSecrets(db, taskId).find((r) => r.name === name)
      if (!row) {
        throw new GraphQLError('Internal: task secret row missing after upsert', {
          extensions: { code: 'INTERNAL_ERROR' },
        })
      }
      return {
        id: row.id,
        name: row.name,
        createdBy: { id: row.createdBy },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    },

    deleteTaskSecret(
      _: unknown,
      { taskId, name }: { taskId: string; name: string },
      ctx: ResolverContext,
    ) {
      const user = requireAuth(ctx)
      requireSecretsEnabled()
      requireTaskAccess(taskId, user)
      validateSecretName(name)
      storeDeleteTaskSecret(db, taskId, name)
      reResolveAfterSecretChange(name, { taskIdScope: taskId })
      return true
    },

    setTaskRequiredSecrets(
      _: unknown,
      { taskId, names }: { taskId: string; names: string[] },
      ctx: ResolverContext,
    ) {
      const user = requireAuth(ctx)
      // Intentionally does NOT require secretsEnabled() — declaring requirements
      // must work when the feature is off so tasks can transition to MISSING_SECRETS.
      requireTaskAccess(taskId, user)
      const unique = Array.from(new Set(names))
      for (const n of unique) validateSecretName(n)
      db.run(
        `UPDATE tasks SET required_secrets = ?, updated_at = datetime('now') WHERE id = ?`,
        [JSON.stringify(unique), taskId],
      )
      const row = db.query('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | null
      if (!row) throw notFound('Task', taskId)
      const task = mapTask(row)
      publishTaskUpdated(task)
      return task
    },

    setTimeBox(
      _: unknown,
      { taskId, timeBoxMs }: { taskId: string; timeBoxMs: number | null },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)
      if (timeBoxMs !== null && timeBoxMs !== undefined && timeBoxMs < 1000) {
        throw new GraphQLError('timeBoxMs must be at least 1000 (1s) or null', {
          extensions: { code: 'BAD_USER_INPUT' },
        })
      }
      db.run(
        `UPDATE tasks SET time_box_ms = ?, updated_at = datetime('now') WHERE id = ?`,
        [timeBoxMs ?? null, taskId],
      )
      const row = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(taskId) as TaskRow | null
      if (!row) throw notFound('Task', taskId)
      const task = mapTask(row)
      publishTaskUpdated(task)
      return task
    },

    async unarchivePlaybook(
      _: unknown,
      { id }: { id: string },
      ctx: ResolverContext,
    ) {
      requireAuth(ctx)
      try {
        return mapPlaybook(unarchivePlaybook(db, id))
      } catch (e) {
        if (e instanceof PlaybookNotFoundError) {
          throw new GraphQLError(e.message, {
            extensions: { code: 'PLAYBOOK_NOT_FOUND' },
          })
        }
        throw e
      }
    },

    unarchiveTask(_: unknown, { id }: { id: string }, ctx: ResolverContext) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(id, authUser)
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
      const authUser = requireAuth(ctx)
      const { authorId } = requireCommentAccess(id, authUser)
      // Only the author or a super-admin may edit an existing comment
      if (authUser.role !== 'super-admin' && authorId !== authUser.id) {
        throw notFound('Comment', id)
      }
      return commentService.updateComment({ body, id })
    },

    async updatePlaybook(
      _: unknown,
      {
        id,
        input,
      }: {
        id: string
        input: {
          displayName?: string | null
          description?: string | null
          promptTemplate?: string | null
          defaultsJson?: string | null
          allowedToolsOverride?: string[] | null
        }
      },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      // Validate the effective resulting version shape (use existing values for unset fields)
      try {
        if (input.promptTemplate != null) {
          Mustache.parse(input.promptTemplate)
        }
        if (input.defaultsJson != null) {
          const parsed = JSON.parse(input.defaultsJson)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('defaultsJson must parse to a JSON object')
          }
        }
        if (input.allowedToolsOverride) {
          for (const tool of input.allowedToolsOverride) {
            if (!VALID_TOOL_NAMES.has(tool)) {
              throw new Error(`Unknown tool: ${tool}`)
            }
          }
        }
      } catch (e) {
        throw new GraphQLError((e as Error).message, {
          extensions: { code: 'BAD_USER_INPUT' },
        })
      }
      try {
        // Explicit-null semantics: if the client passed `allowedToolsOverride: null`,
        // we want to CLEAR the previous override, not preserve it. `??` would
        // coerce null to undefined (= preserve), which is wrong. Use the `in`
        // check to distinguish "field omitted" from "field set to null".
        const pb = updatePlaybook(db, id, {
          allowedToolsOverride:
            'allowedToolsOverride' in input
              ? (input.allowedToolsOverride ?? null)
              : undefined,
          createdBy: authUser.id,
          defaultsJson: input.defaultsJson ?? undefined,
          description: input.description ?? undefined,
          displayName: input.displayName ?? undefined,
          promptTemplate: input.promptTemplate ?? undefined,
        })
        return mapPlaybook(pb)
      } catch (e) {
        if (e instanceof PlaybookNotFoundError) {
          throw new GraphQLError(e.message, {
            extensions: { code: 'PLAYBOOK_NOT_FOUND' },
          })
        }
        if (e instanceof PlaybookArchivedError) {
          throw new GraphQLError(e.message, {
            extensions: { code: 'PLAYBOOK_ARCHIVED' },
          })
        }
        throw e
      }
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
      requireTaskAccess(id, authUser)
      validateTargetRepo(input.targetRepo)
      validateTargetBranch(input.targetBranch)
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
    agentRuns(
      _: unknown,
      { taskId }: { taskId: string },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)
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

    board(_: unknown, { id }: { id: string }, ctx: ResolverContext) {
      const authUser = requireAuth(ctx)
      const row = db
        .query('SELECT * FROM boards WHERE id = ?')
        .get(id) as BoardRow | null
      if (!row) return null
      if (authUser.role !== 'super-admin' && row.created_by !== authUser.id) {
        return null
      }
      return mapBoard(row)
    },
    boards(_: unknown, __: unknown, ctx: ResolverContext) {
      const authUser = requireAuth(ctx)
      const rows =
        authUser.role === 'super-admin'
          ? (db
              .query('SELECT * FROM boards ORDER BY created_at ASC')
              .all() as BoardRow[])
          : (db
              .query(
                'SELECT * FROM boards WHERE created_by = ? ORDER BY created_at ASC',
              )
              .all(authUser.id) as BoardRow[])
      return rows.map(mapBoard)
    },

    comments(_: unknown, { taskId }: { taskId: string }, ctx: ResolverContext) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)
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

    playbooks(_: unknown, __: unknown, ctx: ResolverContext) {
      requireAuth(ctx)
      return listPlaybooks(db).map(mapPlaybook)
    },

    tags(_: unknown, { boardId }: { boardId: string }, ctx: ResolverContext) {
      const authUser = requireAuth(ctx)
      requireBoardAccess(boardId, authUser)
      return getTagsForBoard(boardId)
    },

    task(_: unknown, { id }: { id: string }, ctx: ResolverContext) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(id, authUser)
      return getTaskById(id)
    },

    async taskProgress(
      _: unknown,
      { taskId }: { taskId: string },
      ctx: ResolverContext,
    ): Promise<unknown[]> {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)
      const config = getConfig()
      if (!config) return []
      let buf: Buffer
      try {
        buf = await readFile(progressPath(config, taskId))
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return []
        throw err
      }
      const { entries } = parseProgressLines(`${buf.toString('utf8')}\n`)
      return entries.map((e) => ({
        agentRunId: null,
        detail: e.detail ?? null,
        label: e.label,
        status: e.status.toUpperCase(),
        step: e.step,
        taskId,
        total: e.total,
        ts: e.ts,
      }))
    },

    taskTimeline(
      _: unknown,
      { taskId }: { taskId: string },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      requireTaskAccess(taskId, authUser)
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

    workspaceSnapshot(
      _: unknown,
      { id }: { id: string },
      ctx: ResolverContext,
    ) {
      const authUser = requireAuth(ctx)
      const row = getSnapshotById(db, id)
      if (!row) return null
      requireTaskAccess(row.taskId, authUser)
      return mapSnapshotRow(row)
    },

    workspaceSnapshotPatch(
      _: unknown,
      { id }: { id: string },
      ctx: ResolverContext,
    ): string {
      const authUser = requireAuth(ctx)
      const row = getSnapshotById(db, id)
      if (!row) return ''
      requireTaskAccess(row.taskId, authUser)
      if (!row.hasPatch) return ''
      const blob = getSnapshotPatch(db, id)
      if (!blob) return ''
      try {
        const bytes = new Uint8Array(
          blob.buffer.slice(
            blob.byteOffset,
            blob.byteOffset + blob.byteLength,
          ) as ArrayBuffer,
        )
        const raw = Bun.gunzipSync(bytes)
        return Buffer.from(raw).toString('utf8')
      } catch {
        return ''
      }
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
      subscribe(
        _: unknown,
        { taskId }: { taskId: string },
        ctx: ResolverContext,
      ) {
        const authUser = requireAuth(ctx)
        requireTaskAccess(taskId, authUser)
        return pubsub.subscribe('AGENT_LOG', taskId)
      },
    },

    commentAdded: {
      resolve(payload: Record<string, unknown>) {
        return payload
      },
      subscribe(
        _: unknown,
        { taskId }: { taskId: string },
        ctx: ResolverContext,
      ) {
        const authUser = requireAuth(ctx)
        requireTaskAccess(taskId, authUser)
        return pubsub.subscribe('COMMENT_ADDED', taskId)
      },
    },

    commentUpdated: {
      resolve(payload: Record<string, unknown>) {
        return payload
      },
      subscribe(
        _: unknown,
        { taskId }: { taskId: string },
        ctx: ResolverContext,
      ) {
        const authUser = requireAuth(ctx)
        requireTaskAccess(taskId, authUser)
        return pubsub.subscribe('COMMENT_UPDATED', taskId)
      },
    },

    messageAdded: {
      resolve(payload: Record<string, unknown>) {
        return payload
      },
      subscribe(
        _: unknown,
        { taskId }: { taskId: string },
        ctx: ResolverContext,
      ) {
        const authUser = requireAuth(ctx)
        requireTaskAccess(taskId, authUser)
        return pubsub.subscribe('TASK_MESSAGE', taskId)
      },
    },

    checkpointAdded: {
      resolve(payload: Record<string, unknown>) {
        return payload
      },
      subscribe(
        _: unknown,
        { taskId }: { taskId: string },
        ctx: ResolverContext,
      ) {
        const authUser = requireAuth(ctx)
        requireTaskAccess(taskId, authUser)
        return pubsub.subscribe('AGENT_CHECKPOINT', taskId)
      },
    },

    scratchpadUpdated: {
      resolve(payload: { taskId: string; content: string; updatedAt: string }) {
        return payload
      },
      subscribe(
        _: unknown,
        { taskId }: { taskId: string },
        ctx: ResolverContext,
      ) {
        const authUser = requireAuth(ctx)
        requireTaskAccess(taskId, authUser)

        const config = getConfig()
        const dispose = config
          ? watchScratchpad(config, taskId, (content) => {
              publishScratchpadUpdated(taskId, {
                content,
                taskId,
                updatedAt: new Date().toISOString(),
              })
            })
          : () => {}

        const iterator = pubsub.subscribe('SCRATCHPAD_UPDATED', taskId)
        const originalReturn = iterator.return?.bind(iterator)
        iterator.return = async (value?: unknown) => {
          dispose()
          return originalReturn
            ? originalReturn(value)
            : { done: true, value: undefined }
        }
        return iterator
      },
    },

    taskEventAdded: {
      resolve(payload: Record<string, unknown>) {
        return payload
      },
      subscribe(
        _: unknown,
        { taskId }: { taskId: string },
        ctx: ResolverContext,
      ) {
        const authUser = requireAuth(ctx)
        requireTaskAccess(taskId, authUser)
        return pubsub.subscribe('TASK_EVENT', taskId)
      },
    },

    taskProgressAdded: {
      resolve(payload: unknown) {
        return payload
      },
      subscribe(
        _: unknown,
        { taskId }: { taskId: string },
        ctx: ResolverContext,
      ) {
        const authUser = requireAuth(ctx)
        requireTaskAccess(taskId, authUser)
        return pubsub.subscribe('TASK_PROGRESS', taskId)
      },
    },
    taskUpdated: {
      resolve(payload: Record<string, unknown>) {
        return payload
      },
      subscribe(
        _: unknown,
        { boardId }: { boardId: string },
        ctx: ResolverContext,
      ) {
        const authUser = requireAuth(ctx)
        requireBoardAccess(boardId, authUser)
        return pubsub.subscribe('TASK_UPDATED', boardId)
      },
    },

    verificationRunAdded: {
      resolve(payload: unknown) {
        return payload
      },
      subscribe(
        _: unknown,
        { taskId }: { taskId: string },
        ctx: ResolverContext,
      ) {
        const authUser = requireAuth(ctx)
        requireTaskAccess(taskId, authUser)
        return pubsub.subscribe('VERIFICATION_RUN', taskId)
      },
    },

    workspaceSnapshotAdded: {
      resolve(payload: unknown) {
        return payload
      },
      subscribe(
        _: unknown,
        { taskId }: { taskId: string },
        ctx: ResolverContext,
      ) {
        const authUser = requireAuth(ctx)
        requireTaskAccess(taskId, authUser)
        return pubsub.subscribe('WORKSPACE_SNAPSHOT', taskId)
      },
    },

    taskMissingSecretsChanged: {
      subscribe(
        _: unknown,
        { taskId }: { taskId: string },
        ctx: ResolverContext,
      ) {
        const user = requireAuth(ctx)
        requireTaskAccess(taskId, user)
        return pubsub.subscribe('TASK_MISSING_SECRETS_CHANGED', taskId)
      },
      resolve(payload: { taskId: string; missingSecrets: string[] }) {
        return payload.missingSecrets
      },
    },
  },

  Task: {
    agentRuns(parent: { id: string }) {
      const rows = db
        .query(
          'SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC',
        )
        .all(parent.id) as AgentRunRow[]
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
    blockers(parent: { id: string }) {
      const ids = listBlockers(db, parent.id)
      if (ids.length === 0) return []
      const placeholders = ids.map(() => '?').join(',')
      const rows = db
        .query(`SELECT * FROM tasks WHERE id IN (${placeholders})`)
        .all(...ids) as TaskRow[]
      // preserve the add-order returned by listBlockers
      const order = new Map(ids.map((id, i) => [id, i] as const))
      return rows
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        .map(mapTask)
    },
    blockReason(parent: ReturnType<typeof mapTask>) {
      return (parent as unknown as { blockReason: string | null }).blockReason
    },
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
    currentQuestion(task: ReturnType<typeof mapTask>) {
      const q = getCurrentQuestion(db, task.id)
      return q ? mapTaskMessage(q) : null
    },
    dependents(parent: { id: string }) {
      const ids = listDependents(db, parent.id)
      if (ids.length === 0) return []
      const placeholders = ids.map(() => '?').join(',')
      const rows = db
        .query(`SELECT * FROM tasks WHERE id IN (${placeholders})`)
        .all(...ids) as TaskRow[]
      const order = new Map(ids.map((id, i) => [id, i] as const))
      return rows
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        .map(mapTask)
    },
    messages(task: ReturnType<typeof mapTask>) {
      return listMessagesForTask(db, task.id).map(mapTaskMessage)
    },
    parentTask(parent: ReturnType<typeof mapTask>) {
      const pid = (parent as unknown as { parentTaskId: string | null })
        .parentTaskId
      if (!pid) return null
      const row = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(pid) as TaskRow | null
      return row ? mapTask(row) : null
    },
    async scratchpad(task: ReturnType<typeof mapTask>): Promise<string> {
      const config = getConfig()
      if (!config) return ''
      return readScratchpad(config, task.id)
    },
    subtasks(parent: { id: string }) {
      const rows = db
        .query(
          'SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC',
        )
        .all(parent.id) as TaskRow[]
      return rows.map(mapTask)
    },
    tags(task: ReturnType<typeof mapTask>) {
      return getTagsForTask(task.id)
    },
    timeBoxRemainingMs(parent: ReturnType<typeof mapTask>) {
      const { timeBoxMs, timeBoxStartedAt, agentStatus } =
        parent as unknown as {
          timeBoxMs: number | null
          timeBoxStartedAt: string | null
          agentStatus: string
        }
      if (agentStatus !== 'RUNNING') return null
      if (!timeBoxMs || !timeBoxStartedAt) return null
      const started = new Date(`${timeBoxStartedAt}Z`).getTime()
      const elapsed = Date.now() - started
      const remaining = timeBoxMs - elapsed
      return Math.max(0, remaining)
    },
    updatedBy(task: ReturnType<typeof mapTask>) {
      return getUserById(task._updatedBy)
    },
    verificationRuns(parent: { id: string }) {
      return listVerificationRunsForTask(db, parent.id).map((r) => ({
        agentRunId: r.agentRunId,
        command: r.command,
        exitCode: r.exitCode,
        finishedAt: r.finishedAt,
        id: r.id,
        label: r.label,
        output: r.output,
        startedAt: r.startedAt,
        taskId: r.taskId,
      }))
    },
    verifyAttemptCount(parent: { id: string }): number {
      const row = db
        .query('SELECT verify_attempt_count FROM tasks WHERE id = ?')
        .get(parent.id) as { verify_attempt_count: number } | null
      return row?.verify_attempt_count ?? 0
    },
    verifyCommandsOverride(parent: { id: string }) {
      const row = db
        .query('SELECT verify_commands FROM tasks WHERE id = ?')
        .get(parent.id) as { verify_commands: string | null } | null
      if (!row?.verify_commands) return null
      try {
        const parsed = JSON.parse(row.verify_commands) as Array<{
          label: string
          run: string
          timeoutMs?: number
          timeout_ms?: number
        }>
        return parsed.map((c) => ({
          label: c.label,
          run: c.run,
          timeoutMs: c.timeoutMs ?? c.timeout_ms ?? null,
        }))
      } catch {
        return null
      }
    },
    workspaceSnapshots(parent: { id: string }) {
      return listSnapshotsForTask(db, parent.id).map(mapSnapshotRow)
    },
    requiredSecrets(parent: { id: string; required_secrets?: string }, _args: unknown, ctx: ResolverContext): string[] {
      const user = requireAuth(ctx)
      requireTaskAccess(parent.id, user)
      // Prefer raw column if mapTask included it, otherwise fall back to a DB query.
      const raw = parent.required_secrets ??
        (db.query('SELECT required_secrets FROM tasks WHERE id = ?').get(parent.id) as { required_secrets: string } | null)?.required_secrets
      return parseRequiredSecrets(raw)
    },
    missingSecrets(parent: { id: string }, _args: unknown, ctx: ResolverContext) {
      const user = requireAuth(ctx)
      requireTaskAccess(parent.id, user)
      return computeMissingSecretNames(db, parent.id)
    },
    taskSecrets(parent: { id: string }, _args: unknown, ctx: ResolverContext) {
      // Belt-and-braces: enforce auth on this sensitive field too.
      const user = requireAuth(ctx)
      requireTaskAccess(parent.id, user)
      if (!secretsEnabled()) return []
      const rows = listTaskSecrets(db, parent.id)
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdBy: { id: r.createdBy },
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))
    },
  },

  TaskSecret: {
    createdBy(parent: { createdBy: { id: string } }) {
      return getUserById(parent.createdBy.id)
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

  TaskMessage: {
    createdBy(message: { _createdBy: string | null }) {
      if (!message._createdBy) return null
      return getUserById(message._createdBy)
    },
  },

  Playbook: {
    createdBy: (parent: { _createdBy: string }) => {
      const row = db
        .query('SELECT * FROM users WHERE id = ?')
        .get(parent._createdBy) as UserRow
      return mapUser(row)
    },
    versions: (parent: { id: string }) =>
      listPlaybookVersions(db, parent.id).map(mapPlaybookVersion),
  },

  PlaybookVersion: {
    createdBy: (parent: { _createdBy: string }) => {
      const row = db
        .query('SELECT * FROM users WHERE id = ?')
        .get(parent._createdBy) as UserRow
      return mapUser(row)
    },
  },
}

// Test-only — re-export the mapper so unit tests don't reach into module internals.
export { mapTask as mapTaskForTest }
