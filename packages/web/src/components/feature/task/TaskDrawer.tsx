import { useEffect, useRef, useState } from 'react'
import { Drawer } from '@/components/common/drawer'
import { Badge } from '@/components/common/badge'
import { Button } from '@/components/common/button'
import { useBoardStore, type Task } from '@/store/boardStore'
import { graphqlClient } from '@/graphql/client'
import { GET_TASK, GET_BOARD } from '@/graphql/queries'
import {
  CREATE_TASK,
  UPDATE_TASK,
  DELETE_TASK,
  ARCHIVE_TASK,
  UNARCHIVE_TASK,
  DISPATCH_AGENT,
  CANCEL_AGENT,
} from '@/graphql/mutations'
import { TaskTimeline } from './TaskTimeline'
import { TaskComments } from './TaskComments'
import { timeAgo } from './TaskTimeline'

const ACTION_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'plan', label: 'Plan' },
  { value: 'research', label: 'Research' },
  { value: 'implement', label: 'Implement' },
  { value: 'implement-e2e', label: 'Implement E2E' },
  { value: 'revise', label: 'Revise' },
]

type ActionColor = 'default' | 'info' | 'purple' | 'success' | 'teal' | 'warning' | 'error' | 'honey'

function actionColor(action: string | null): ActionColor {
  switch (action) {
    case 'plan': return 'info'
    case 'research': return 'purple'
    case 'implement': return 'honey'
    case 'implement-e2e': return 'teal'
    case 'revise': return 'warning'
    default: return 'default'
  }
}

function agentStatusColor(status: string): ActionColor {
  switch (status) {
    case 'QUEUED': return 'warning'
    case 'RUNNING': return 'info'
    case 'SUCCESS': return 'success'
    case 'FAILED': return 'error'
    default: return 'default'
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface FormState {
  title: string
  body: string
  action: string
  targetRepo: string
}

const emptyForm: FormState = { title: '', body: '', action: '', targetRepo: '' }

interface CreateModeProps {
  form: FormState
  setForm: (f: FormState) => void
  onSubmit: () => Promise<void>
  loading: boolean
}

const CreateMode = ({ form, setForm, onSubmit, loading }: CreateModeProps) => {
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  return (
    <div className="flex grow flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-body-xs text-text-secondary">Title *</label>
        <input
          ref={titleRef}
          className="rounded-md border border-border-default bg-surface-base px-3 py-2 text-body-sm text-text-primary outline-none focus:border-honey-400"
          placeholder="Task title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && onSubmit()}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-body-xs text-text-secondary">Body</label>
        <textarea
          className="min-h-[120px] resize-y rounded-md border border-border-default bg-surface-base px-3 py-2 text-body-sm text-text-primary outline-none focus:border-honey-400"
          placeholder="Optional description…"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-body-xs text-text-secondary">Action</label>
          <select
            className="rounded-md border border-border-default bg-surface-base px-3 py-2 text-body-sm text-text-primary outline-none focus:border-honey-400"
            value={form.action}
            onChange={(e) => setForm({ ...form, action: e.target.value })}
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-body-xs text-text-secondary">Target Repo</label>
          <input
            className="rounded-md border border-border-default bg-surface-base px-3 py-2 text-body-sm text-text-primary outline-none focus:border-honey-400"
            placeholder="owner/repo"
            value={form.targetRepo}
            onChange={(e) => setForm({ ...form, targetRepo: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-auto pt-4">
        <Button
          color="primary"
          block
          disabled={!form.title.trim() || loading}
          onClick={onSubmit}
        >
          {loading ? 'Creating…' : 'Create Task'}
        </Button>
      </div>
    </div>
  )
}

interface ViewModeProps {
  task: Task
  onEdit: () => void
  onArchive: () => Promise<void>
  onDelete: () => Promise<void>
  loading: boolean
}

const ViewMode = ({ task, onEdit, onArchive, onDelete, loading }: ViewModeProps) => {
  return (
    <div className="flex grow flex-col gap-5">
      {/* Title */}
      <h2 className="text-heading-4 text-text-primary">{task.title}</h2>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2">
        {task.action && (
          <Badge color={actionColor(task.action)}>
            {task.action}
          </Badge>
        )}
        {task.targetRepo && (
          <span className="text-body-xs text-text-tertiary">{task.targetRepo}</span>
        )}
      </div>

      {/* Body */}
      {task.body && (
        <p className="whitespace-pre-wrap text-body-sm text-text-secondary">{task.body}</p>
      )}

      {/* PR link */}
      {task.prUrl && (
        <a
          href={task.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-body-sm text-info-400 underline underline-offset-2 hover:text-info-300"
        >
          PR #{task.prNumber} — View on GitHub
        </a>
      )}

      {/* Created info */}
      <p className="text-body-xs text-text-tertiary">
        Created by {task.createdBy.username} · {timeAgo(task.createdAt)}
        {task.updatedAt !== task.createdAt && ` · updated ${timeAgo(task.updatedAt)}`}
      </p>

      {/* Footer actions */}
      <div className="mt-auto flex items-center gap-2 pt-4 border-t border-border-default">
        <Button color="ghost" size="small" onClick={onEdit}>
          Edit
        </Button>
        <Button
          color="default"
          size="small"
          disabled={loading}
          onClick={onArchive}
        >
          {task.archived ? 'Unarchive' : 'Archive'}
        </Button>
        <div className="ml-auto">
          <Button color="danger" size="small" disabled={loading} onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

interface AgentPanelProps {
  task: Task
  onDispatch: (action: string) => Promise<void>
  onCancel: () => Promise<void>
  loading: boolean
  readOnly?: boolean
}

const AgentPanel = ({ task, onDispatch, onCancel, loading, readOnly = false }: AgentPanelProps) => {
  const [dispatchAction, setDispatchAction] = useState(task.action ?? '')

  const isAgentActive = task.agentStatus === 'QUEUED' || task.agentStatus === 'RUNNING'

  return (
    <div className="rounded-lg border border-border-default bg-surface-base p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-xs font-medium text-text-secondary">Agent</span>
        <Badge color={agentStatusColor(task.agentStatus)}>{task.agentStatus}</Badge>
      </div>

      {task.retryCount > 0 && (
        <span className="text-body-xs text-text-tertiary">Retries: {task.retryCount}</span>
      )}

      {task.agentError && (
        <p className="rounded-md bg-error-400/10 px-2 py-1.5 text-body-xs text-error-400 font-mono">
          {task.agentError}
        </p>
      )}

      {/* Dispatch row — disabled in read-only (edit) mode */}
      <div className="flex items-center gap-2">
        <select
          className="flex-1 rounded-md border border-border-default bg-surface-raised px-2 py-1.5 text-body-xs text-text-primary outline-none focus:border-honey-400 disabled:opacity-50"
          value={dispatchAction}
          onChange={(e) => setDispatchAction(e.target.value)}
          disabled={readOnly || isAgentActive || loading}
        >
          {ACTION_OPTIONS.filter((o) => o.value !== '').map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Button
          size="small"
          color="default"
          disabled={readOnly || !dispatchAction || isAgentActive || loading}
          onClick={() => onDispatch(dispatchAction)}
        >
          Dispatch
        </Button>
        {isAgentActive && (
          <Button
            size="small"
            color="danger"
            disabled={readOnly || loading}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

interface EditModeProps {
  form: FormState
  setForm: (f: FormState) => void
  onSave: () => Promise<void>
  onCancel: () => void
  loading: boolean
}

const EditMode = ({ form, setForm, onSave, onCancel, loading }: EditModeProps) => {
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  return (
    <div className="flex grow flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-body-xs text-text-secondary">Title *</label>
        <input
          ref={titleRef}
          className="rounded-md border border-border-default bg-surface-base px-3 py-2 text-body-sm text-text-primary outline-none focus:border-honey-400"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-body-xs text-text-secondary">Body</label>
        <textarea
          className="min-h-[120px] resize-y rounded-md border border-border-default bg-surface-base px-3 py-2 text-body-sm text-text-primary outline-none focus:border-honey-400"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-body-xs text-text-secondary">Action</label>
          <select
            className="rounded-md border border-border-default bg-surface-base px-3 py-2 text-body-sm text-text-primary outline-none focus:border-honey-400"
            value={form.action}
            onChange={(e) => setForm({ ...form, action: e.target.value })}
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-body-xs text-text-secondary">Target Repo</label>
          <input
            className="rounded-md border border-border-default bg-surface-base px-3 py-2 text-body-sm text-text-primary outline-none focus:border-honey-400"
            placeholder="owner/repo"
            value={form.targetRepo}
            onChange={(e) => setForm({ ...form, targetRepo: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4 border-t border-border-default">
        <Button color="primary" disabled={!form.title.trim() || loading} onClick={onSave}>
          {loading ? 'Saving…' : 'Save'}
        </Button>
        <Button color="ghost" disabled={loading} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const TaskDrawer = () => {
  const { drawerMode, selectedTaskId, createTaskColumnId, closeDrawer, setBoard, board } =
    useBoardStore()

  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(false)

  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<FormState>(emptyForm)
  const [createForm, setCreateForm] = useState<FormState>(emptyForm)

  // Fetch task when opening in view mode
  useEffect(() => {
    if (drawerMode === 'view' && selectedTaskId) {
      setLoading(true)
      graphqlClient
        .request<{ task: Task }>(GET_TASK, { id: selectedTaskId })
        .then((data) => setTask(data.task))
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [drawerMode, selectedTaskId])

  // Reset local state on close
  useEffect(() => {
    if (drawerMode === 'closed') {
      setIsEditing(false)
      setTask(null)
      setCreateForm(emptyForm)
      setEditForm(emptyForm)
    }
  }, [drawerMode])

  // Refetch board after mutations
  const refetchBoard = async () => {
    if (!board) return
    const data = await graphqlClient.request<{ board: typeof board }>(GET_BOARD, { id: board.id })
    setBoard(data.board)
  }

  const handleCreate = async () => {
    if (!createForm.title.trim() || !createTaskColumnId) return
    setLoading(true)
    try {
      await graphqlClient.request(CREATE_TASK, {
        input: {
          columnId: createTaskColumnId,
          title: createForm.title.trim(),
          body: createForm.body || null,
          action: createForm.action || null,
          targetRepo: createForm.targetRepo.trim() || null,
        },
      })
      await refetchBoard()
      closeDrawer()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!task || !editForm.title.trim()) return
    setLoading(true)
    try {
      const updated = await graphqlClient.request<{ updateTask: Task }>(UPDATE_TASK, {
        id: task.id,
        input: {
          title: editForm.title.trim(),
          body: editForm.body || null,
          action: editForm.action || null,
          targetRepo: editForm.targetRepo.trim() || null,
        },
      })
      setTask(updated.updateTask)
      await refetchBoard()
      setIsEditing(false)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleArchive = async () => {
    if (!task) return
    setLoading(true)
    try {
      const mutation = task.archived ? UNARCHIVE_TASK : ARCHIVE_TASK
      const key = task.archived ? 'unarchiveTask' : 'archiveTask'
      const data = await graphqlClient.request<Record<string, Partial<Task>>>(mutation, {
        id: task.id,
      })
      setTask({ ...task, ...data[key] })
      await refetchBoard()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!task) return
    if (!window.confirm('Are you sure you want to delete this task?')) return
    setLoading(true)
    try {
      await graphqlClient.request(DELETE_TASK, { id: task.id })
      await refetchBoard()
      closeDrawer()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleDispatch = async (action: string) => {
    if (!task) return
    setLoading(true)
    try {
      const data = await graphqlClient.request<{ dispatchAgent: Partial<Task> }>(DISPATCH_AGENT, {
        taskId: task.id,
        action,
      })
      setTask({ ...task, ...data.dispatchAgent })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelAgent = async () => {
    if (!task) return
    setLoading(true)
    try {
      const data = await graphqlClient.request<{ cancelAgent: Partial<Task> }>(CANCEL_AGENT, {
        taskId: task.id,
      })
      setTask({ ...task, ...data.cancelAgent })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const enterEdit = () => {
    if (!task) return
    setEditForm({
      title: task.title,
      body: task.body ?? '',
      action: task.action ?? '',
      targetRepo: task.targetRepo ?? '',
    })
    setIsEditing(true)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setEditForm(emptyForm)
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'New Task'
      : task?.title ?? (loading ? 'Loading…' : 'Task')

  return (
    <Drawer
      title={drawerTitle}
      open={drawerMode !== 'closed'}
      onOpenChange={(open) => {
        if (!open) closeDrawer()
      }}
    >
      {drawerMode === 'create' && (
        <CreateMode
          form={createForm}
          setForm={setCreateForm}
          onSubmit={handleCreate}
          loading={loading}
        />
      )}

      {drawerMode === 'view' && loading && !task && (
        <div className="flex grow items-center justify-center">
          <span className="text-body-sm text-text-tertiary">Loading…</span>
        </div>
      )}

      {drawerMode === 'view' && task && !isEditing && (
        <ViewMode
          task={task}
          onEdit={enterEdit}
          onArchive={handleArchive}
          onDelete={handleDelete}
          loading={loading}
        />
      )}

      {drawerMode === 'view' && task && isEditing && (
        <EditMode
          form={editForm}
          setForm={setEditForm}
          onSave={handleSaveEdit}
          onCancel={cancelEdit}
          loading={loading}
        />
      )}

      {/* Agent panel visible in both view and edit modes (read-only during edit) */}
      {drawerMode === 'view' && task && (
        <AgentPanel
          task={task}
          onDispatch={handleDispatch}
          onCancel={handleCancelAgent}
          loading={loading}
          readOnly={isEditing}
        />
      )}

      {/* Timeline + Comments — view mode only, not during edit */}
      {drawerMode === 'view' && task && !isEditing && (
        <div className="flex flex-col gap-4 border-t border-border-default pt-4">
          <div className="flex flex-col gap-2">
            <span className="text-body-xs font-medium uppercase tracking-wide text-text-secondary">
              Activity
            </span>
            <TaskTimeline taskId={task.id} />
          </div>
          <TaskComments taskId={task.id} />
        </div>
      )}
    </Drawer>
  )
}
