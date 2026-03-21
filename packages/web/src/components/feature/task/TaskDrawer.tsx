import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  ArchiveIcon,
  Badge,
  Button,
  Drawer,
  MarkdownEditor,
  MarkdownPreview,
  PencilIcon,
  RefreshIcon,
  SelectInput,
  TextInput,
} from '@/components/common'
import { AgentLogStream } from '@/components/feature/agent'
import {
  ARCHIVE_TASK,
  CANCEL_AGENT,
  CREATE_TASK,
  DISPATCH_AGENT,
  GET_BOARD,
  GET_TASK,
  graphqlClient,
  UNARCHIVE_TASK,
  UPDATE_TASK,
} from '@/graphql'
import { type Task, useBoardStore } from '@/store'
import type {
  ActionColor,
  AgentPanelProps,
  CreateModeProps,
  EditModeProps,
  FormState,
  ViewModeProps,
} from '@/types'
import { TaskComments } from './TaskComments'
import { TaskTimeline, timeAgo } from './TaskTimeline'

const ACTION_OPTIONS = [
  { value: 'idle', label: 'Idle' },
  { value: 'plan', label: 'Plan' },
  { value: 'research', label: 'Research' },
  { value: 'implement', label: 'Implement' },
  { value: 'implement-e2e', label: 'Implement E2E' },
  { value: 'revise', label: 'Revise' },
]

function actionColor(action: string | null): ActionColor {
  switch (action) {
    case 'plan':
      return 'info'
    case 'research':
      return 'purple'
    case 'implement':
      return 'honey'
    case 'implement-e2e':
      return 'teal'
    case 'revise':
      return 'warning'
    default:
      return 'default'
  }
}

function agentStatusColor(status: string): ActionColor {
  switch (status) {
    case 'QUEUED':
      return 'warning'
    case 'RUNNING':
      return 'info'
    case 'SUCCESS':
      return 'success'
    case 'FAILED':
      return 'error'
    default:
      return 'default'
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const emptyForm: FormState = {
  title: '',
  body: '## Description\n',
  action: '',
  targetRepo: '',
  targetBranch: 'main',
}

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <span className="text-body-xs font-semibold uppercase tracking-widest text-text-tertiary">
    {children}
  </span>
)

const FieldLabel = ({
  htmlFor,
  children,
  required,
}: {
  htmlFor?: string
  children: ReactNode
  required?: boolean
}) => (
  <label
    htmlFor={htmlFor}
    className="text-body-sm font-medium text-text-secondary"
  >
    {children}
    {required && <span className="ml-0.5 text-honey-400">*</span>}
  </label>
)

const CreateMode = ({ form, setForm, onSubmit, loading }: CreateModeProps) => {
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  return (
    <div className="flex grow flex-col gap-6">
      {/* Title */}
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="create-title" required>
          Title
        </FieldLabel>
        <TextInput
          id="create-title"
          ref={titleRef}
          placeholder="Task title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && onSubmit()}
        />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2">
        <FieldLabel>Body</FieldLabel>
        <MarkdownEditor
          value={form.body}
          onChange={(v) => setForm({ ...form, body: v })}
          placeholder="Optional description…"
          rows={12}
        />
      </div>

      {/* Target config */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Configuration</SectionLabel>
        <div className="rounded-lg border border-border-default bg-surface-overlay/30 p-4">
          <div className="grid grid-cols-[1fr_1fr] gap-3">
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="edit-target-repo">
                Target Repository
              </FieldLabel>
              <TextInput
                id="edit-target-repo"
                placeholder="owner/repo"
                value={form.targetRepo}
                onChange={(e) =>
                  setForm({ ...form, targetRepo: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="edit-target-branch">Branch</FieldLabel>
              <TextInput
                id="edit-target-branch"
                placeholder="main"
                value={form.targetBranch}
                onChange={(e) =>
                  setForm({ ...form, targetBranch: e.target.value })
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto border-t border-border-default pt-5">
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

const ViewMode = ({ task, onEdit, onArchive, loading }: ViewModeProps) => {
  return (
    <div className="flex grow flex-col gap-6">
      {/* Header area */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-heading-3 font-semibold leading-tight text-text-primary">
            {task.title}
          </h2>
          <div className="flex shrink-0 items-center gap-1 pt-0.5">
            <Button
              color="ghost"
              size="small"
              onClick={onEdit}
              title="Edit task"
            >
              <PencilIcon size={16} />
            </Button>
            <Button
              color="ghost"
              size="small"
              disabled={loading}
              onClick={onArchive}
              title={task.archived ? 'Unarchive task' : 'Archive task'}
            >
              {task.archived ? (
                <RefreshIcon size={16} />
              ) : (
                <ArchiveIcon size={16} />
              )}
            </Button>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2">
          {task.action && (
            <Badge color={actionColor(task.action)}>{task.action}</Badge>
          )}
          {task.targetRepo && (
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-overlay px-2 py-0.5 text-body-xs font-mono text-text-tertiary">
              {task.targetRepo}
              {task.targetBranch && task.targetBranch !== 'main' && (
                <span className="text-text-secondary">
                  @{task.targetBranch}
                </span>
              )}
            </span>
          )}
          {task.prUrl && (
            <a
              href={task.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-info-400/10 px-2 py-0.5 text-body-xs font-medium text-info-400 transition-colors hover:bg-info-400/20"
            >
              PR #{task.prNumber}
            </a>
          )}
        </div>
      </div>

      {/* Body */}

      {task.body ? (
        <MarkdownPreview content={task.body} />
      ) : (
        <p className="text-body-sm italic text-text-tertiary">No description</p>
      )}

      {/* Timestamp */}
      <p className="text-body-xs text-text-tertiary">
        Created by{' '}
        <span className="font-medium text-text-secondary">
          {task.createdBy.username}
        </span>{' '}
        · {timeAgo(task.createdAt)}
        {task.updatedAt !== task.createdAt &&
          ` · updated ${timeAgo(task.updatedAt)}`}
      </p>
    </div>
  )
}

const AgentPanel = ({
  task,
  onDispatch,
  onCancel,
  loading,
  onUpdateAction,
}: AgentPanelProps) => {
  const isAgentActive =
    task.agentStatus === 'QUEUED' || task.agentStatus === 'RUNNING'

  return (
    <div className="rounded-lg border border-border-default bg-surface-overlay/40 p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={`size-2 rounded-full ${
              isAgentActive
                ? 'animate-pulse bg-info-400'
                : task.agentStatus === 'SUCCESS'
                  ? 'bg-success-400'
                  : task.agentStatus === 'FAILED'
                    ? 'bg-error-400'
                    : 'bg-gray-600'
            }`}
          />
          <SectionLabel>Agent</SectionLabel>
        </div>
        <Badge color={agentStatusColor(task.agentStatus)}>
          {task.agentStatus}
        </Badge>
      </div>

      {/* Retry count */}
      {task.retryCount > 0 && (
        <span className="text-body-xs text-text-tertiary">
          Retries: {task.retryCount}
        </span>
      )}

      {/* Error */}
      {task.agentError && (
        <p className="rounded-md border border-error-400/20 bg-error-400/10 px-3 py-2 text-body-xs text-error-400 font-mono leading-relaxed">
          {task.agentError}
        </p>
      )}

      {/* Action select + Dispatch + Cancel */}
      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1">
          <SelectInput
            value={task.action || undefined}
            placeholder="Select action…"
            options={ACTION_OPTIONS.filter((o) => o.value !== '')}
            onValueChange={onUpdateAction}
            disabled={isAgentActive || loading}
          />
        </div>
        <Button
          color="primary"
          disabled={!task.action || isAgentActive || loading}
          onClick={() => task.action && onDispatch(task.action)}
        >
          Dispatch
        </Button>
        {isAgentActive && (
          <Button color="danger" disabled={loading} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

const EditMode = ({
  form,
  setForm,
  onSave,
  onCancel,
  loading,
}: EditModeProps) => {
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  return (
    <div className="flex grow flex-col gap-6">
      {/* Title */}
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="edit-title" required>
          Title
        </FieldLabel>
        <TextInput
          id="edit-title"
          ref={titleRef}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2">
        <FieldLabel>Body</FieldLabel>
        <MarkdownEditor
          value={form.body}
          onChange={(v) => setForm({ ...form, body: v })}
          rows={12}
        />
      </div>

      {/* Configuration section */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Configuration</SectionLabel>

        <div className="rounded-lg border border-border-default bg-surface-overlay/30 p-4">
          <div className="grid grid-cols-[1fr_1fr] gap-3">
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="edit-target-repo">
                Target Repository
              </FieldLabel>
              <TextInput
                id="edit-target-repo"
                placeholder="owner/repo"
                value={form.targetRepo}
                onChange={(e) =>
                  setForm({ ...form, targetRepo: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="edit-target-branch">Branch</FieldLabel>
              <TextInput
                id="edit-target-branch"
                placeholder="main"
                value={form.targetBranch}
                onChange={(e) =>
                  setForm({ ...form, targetBranch: e.target.value })
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center gap-3 border-t border-border-default pt-5 *:w-1/2">
        <Button
          color="primary"
          size="large"
          disabled={!form.title.trim() || loading}
          onClick={onSave}
        >
          {loading ? 'Saving…' : 'Save Changes'}
        </Button>
        <Button
          color="ghost"
          size="large"
          disabled={loading}
          onClick={onCancel}
        >
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
  const {
    drawerMode,
    selectedTaskId,
    createTaskColumnId,
    closeDrawer,
    setBoard,
    board,
  } = useBoardStore()

  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(false)

  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<FormState>(emptyForm)
  const [createForm, setCreateForm] = useState<FormState>(emptyForm)

  // Fetch task when opening in view mode
  useEffect(() => {
    if (drawerMode === 'view' && selectedTaskId) {
      let cancelled = false
      setTask(null)
      setLoading(true)
      graphqlClient
        .request<{ task: Task }>(GET_TASK, { id: selectedTaskId })
        .then((data) => {
          if (!cancelled) setTask(data.task)
        })
        .catch((err) => {
          if (!cancelled) console.error(err)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
      return () => {
        cancelled = true
      }
    }
  }, [drawerMode, selectedTaskId])

  // Reset local state on close
  useEffect(() => {
    if (drawerMode === 'closed') {
      setIsEditing(false)
      setTask(null)
      setLoading(false)
      setCreateForm(emptyForm)
      setEditForm(emptyForm)
    }
  }, [drawerMode])

  // Refetch board after mutations
  const refetchBoard = async () => {
    if (!board) return
    const data = await graphqlClient.request<{ board: typeof board }>(
      GET_BOARD,
      { id: board.id },
    )
    setBoard(data.board)
  }

  const handleCreate = async () => {
    if (!createForm.title.trim() || !createTaskColumnId || !board) return
    setLoading(true)
    try {
      await graphqlClient.request(CREATE_TASK, {
        input: {
          boardId: board.id,
          columnId: createTaskColumnId,
          title: createForm.title.trim(),
          body: createForm.body || null,
          action: createForm.action || null,
          targetRepo: createForm.targetRepo.trim() || null,
          targetBranch: createForm.targetBranch.trim() || 'main',
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
      const updated = await graphqlClient.request<{ updateTask: Task }>(
        UPDATE_TASK,
        {
          id: task.id,
          input: {
            title: editForm.title.trim(),
            body: editForm.body,
            action: editForm.action || null,
            targetRepo: editForm.targetRepo.trim() || null,
            targetBranch: editForm.targetBranch.trim() || null,
          },
        },
      )
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
      const data = await graphqlClient.request<Record<string, Partial<Task>>>(
        mutation,
        {
          id: task.id,
        },
      )
      setTask({ ...task, ...data[key] })
      await refetchBoard()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateAction = async (action: string) => {
    if (!task) return
    setLoading(true)
    try {
      const updated = await graphqlClient.request<{ updateTask: Task }>(
        UPDATE_TASK,
        {
          id: task.id,
          input: { action: action || null },
        },
      )
      setTask(updated.updateTask)
      await refetchBoard()
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
      const data = await graphqlClient.request<{
        dispatchAgent: Partial<Task>
      }>(DISPATCH_AGENT, {
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
      const data = await graphqlClient.request<{ cancelAgent: Partial<Task> }>(
        CANCEL_AGENT,
        {
          taskId: task.id,
        },
      )
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
      targetBranch: task.targetBranch ?? 'main',
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
      : (task?.title ?? (loading ? 'Loading…' : 'Task'))

  return (
    <Drawer
      title={drawerTitle}
      open={drawerMode !== 'closed'}
      onOpenChange={(open) => {
        if (!open) closeDrawer()
      }}
      size="wide"
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

      {/* Agent panel — view mode only, hidden during edit */}
      {drawerMode === 'view' && task && !isEditing && (
        <AgentPanel
          task={task}
          onDispatch={handleDispatch}
          onCancel={handleCancelAgent}
          onUpdateAction={handleUpdateAction}
          loading={loading}
        />
      )}

      {/* Agent log stream — visible when running or has been run */}
      {drawerMode === 'view' &&
        task &&
        !isEditing &&
        (task.agentStatus === 'RUNNING' || task.agentOutput) && (
          <AgentLogStream taskId={task.id} agentStatus={task.agentStatus} />
        )}

      {/* Timeline — view mode only, not during edit */}
      {drawerMode === 'view' && task && !isEditing && (
        <div className="flex flex-col gap-3 border-t border-border-default pt-5">
          <SectionLabel>Activity</SectionLabel>
          <TaskTimeline taskId={task.id} />
        </div>
      )}

      {/* Comments — view mode only, not during edit */}
      {drawerMode === 'view' && task && !isEditing && (
        <div className="flex flex-col gap-3 border-t border-border-default pt-5">
          <SectionLabel>Comments</SectionLabel>
          <TaskComments taskId={task.id} />
        </div>
      )}
    </Drawer>
  )
}
