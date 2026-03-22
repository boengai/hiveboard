import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArchiveIcon,
  Avatar,
  Badge,
  Button,
  ComboboxInput,
  Drawer,
  MarkdownEditor,
  MarkdownPreview,
  PencilIcon,
  RefreshIcon,
  SelectInput,
  TextInput,
} from '@/components/common'
import { GitHubIcon } from '@/components/common/icon'
import { AgentLogStream } from '@/components/feature/agent'
import {
  ARCHIVE_TASK,
  CANCEL_AGENT,
  CREATE_TAG,
  CREATE_TASK,
  DISPATCH_AGENT,
  GET_BOARD,
  GET_TASK,
  graphqlClient,
  UNARCHIVE_TASK,
  UPDATE_TASK,
} from '@/graphql'
import { useImageUpload } from '@/hooks/useImageUpload'
import { type Tag, type Task, useBoardStore } from '@/store'
import type {
  ActionColor,
  AgentPanelProps,
  CreateModeProps,
  EditModeProps,
  FormState,
  ViewModeProps,
} from '@/types'
import { hashToColor, tv } from '@/utils'
import { TaskComments } from './TaskComments'
import { TaskTimeline, timeAgo } from './TaskTimeline'

const agentDot = tv({
  base: 'size-2 rounded-full',
  defaultVariants: { status: 'idle' },
  variants: {
    status: {
      active: 'animate-pulse bg-info-400',
      failed: 'bg-error-400',
      idle: 'bg-gray-600',
      success: 'bg-success-400',
    },
  },
})

const ACTION_OPTIONS = [
  { label: 'Idle', value: 'idle' },
  { label: 'Plan', value: 'plan' },
  { label: 'Research', value: 'research' },
  { label: 'Implement', value: 'implement' },
  { label: 'Implement E2E', value: 'implement-e2e' },
  { label: 'Revise', value: 'revise' },
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
  action: '',
  body: '## Description\n',
  tagIds: [],
  targetBranch: 'main',
  targetRepo: '',
  title: '',
}

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <span className="font-semibold text-body-xs text-text-tertiary uppercase tracking-widest">
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
    className="font-medium text-body-sm text-text-secondary"
    htmlFor={htmlFor}
  >
    {children}
    {required && <span className="ml-0.5 text-honey-400">*</span>}
  </label>
)

const CreateMode = ({
  form,
  setForm,
  onSubmit,
  loading,
  boardTags,
  onCreateTag,
  repoOptions,
  branchOptions,
  onImageUpload,
  uploading,
}: CreateModeProps) => {
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
          onChange={(v) => setForm({ ...form, title: v })}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && onSubmit()}
          placeholder="Task title"
          ref={titleRef}
          value={form.title}
        />
      </div>

      {/* Tags */}
      <div className="flex flex-col gap-2">
        <FieldLabel>Tags</FieldLabel>
        <ComboboxInput
          createLabel="Add tag"
          multiple
          onCreateOption={onCreateTag}
          onValueChange={(ids) => setForm({ ...form, tagIds: ids })}
          options={boardTags.map((t) => ({
            color: t.color,
            label: t.name,
            value: t.id,
          }))}
          placeholder="Search or create tags…"
          value={form.tagIds}
        />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2">
        <FieldLabel>Body</FieldLabel>
        <MarkdownEditor
          onChange={(v) => setForm({ ...form, body: v })}
          onImageUpload={onImageUpload}
          placeholder="Optional description…"
          rows={12}
          uploading={uploading}
          value={form.body}
        />
      </div>

      {/* Target config */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Configuration</SectionLabel>
        <div className="rounded-lg border border-border-default bg-surface-overlay/30 p-4">
          <div className="grid grid-cols-[1fr_1fr] gap-3">
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="create-target-repo" required>
                Target Repository
              </FieldLabel>
              <ComboboxInput
                createLabel="Use"
                id="create-target-repo"
                onCreateOption={(name) =>
                  setForm({ ...form, targetRepo: name })
                }
                onValueChange={(v) => setForm({ ...form, targetRepo: v })}
                options={repoOptions}
                placeholder="owner/repo"
                value={form.targetRepo}
              />
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="create-target-branch" required>
                Branch
              </FieldLabel>
              <ComboboxInput
                createLabel="Use"
                id="create-target-branch"
                onCreateOption={(name) =>
                  setForm({ ...form, targetBranch: name })
                }
                onValueChange={(v) => setForm({ ...form, targetBranch: v })}
                options={branchOptions}
                placeholder="main"
                value={form.targetBranch}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto border-border-default border-t pt-5">
        <Button
          block
          color="primary"
          disabled={
            !form.title.trim() ||
            !form.targetRepo.trim() ||
            !form.targetBranch.trim() ||
            loading
          }
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
          <h2 className="font-semibold text-heading-3 text-text-primary leading-tight">
            {task.title}
          </h2>
          <div className="flex shrink-0 items-center gap-1 pt-0.5">
            <Button
              color="ghost"
              onClick={onEdit}
              size="small"
              title="Edit task"
            >
              <PencilIcon size={16} />
            </Button>
            <Button
              color="ghost"
              disabled={loading}
              onClick={onArchive}
              size="small"
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
          {task.targetRepo && (
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1 rounded-md bg-surface-overlay px-2 py-0.5 font-mono text-body-xs text-text-tertiary">
                <GitHubIcon size={14} />
                <span>{task.targetRepo}</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {task.action && (
            <Badge color={actionColor(task.action)}>{task.action}</Badge>
          )}
          {task.prUrl && (
            <a
              className="inline-flex items-center gap-1 rounded-md bg-info-400/10 px-2 py-0.5 font-medium text-body-xs text-info-400 transition-colors hover:bg-info-400/20"
              href={task.prUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              PR #{task.prNumber}
            </a>
          )}
          {task.tags?.map((tag) => {
            const bg = `${tag.color}20`
            return (
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 font-medium text-body-xs"
                key={tag.id}
                style={{ backgroundColor: bg, color: tag.color }}
              >
                {tag.name}
              </span>
            )
          })}
        </div>
      </div>

      {/* Body */}

      {task.body ? (
        <MarkdownPreview content={task.body} />
      ) : (
        <p className="text-body-sm text-text-tertiary italic">No description</p>
      )}

      {/* Timestamp */}
      <div className="flex items-center gap-1.5 text-body-xs text-text-tertiary">
        <Avatar name={task.createdBy.username} size="sm" />
        <span>
          <span className="font-medium text-text-secondary">
            {task.createdBy.username}
          </span>
          {' · '}
          {timeAgo(task.createdAt)}
          {task.updatedAt !== task.createdAt &&
            ` · updated ${timeAgo(task.updatedAt)}`}
        </span>
      </div>
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
    <div className="flex flex-col gap-3 rounded-lg border border-border-default bg-surface-overlay/40 p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={agentDot({
              status: isAgentActive
                ? 'active'
                : task.agentStatus === 'SUCCESS'
                  ? 'success'
                  : task.agentStatus === 'FAILED'
                    ? 'failed'
                    : 'idle',
            })}
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
        <p className="rounded-md border border-error-400/20 bg-error-400/10 px-3 py-2 font-mono text-body-xs text-error-400 leading-relaxed">
          {task.agentError}
        </p>
      )}

      {/* Action select + Dispatch + Cancel */}
      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1">
          <SelectInput
            disabled={isAgentActive || loading}
            onValueChange={onUpdateAction}
            options={ACTION_OPTIONS.filter((o) => o.value !== '')}
            placeholder="Select action…"
            value={task.action || undefined}
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
  boardTags,
  onCreateTag,
  repoOptions,
  branchOptions,
  onImageUpload,
  uploading,
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
          onChange={(v) => setForm({ ...form, title: v })}
          ref={titleRef}
          value={form.title}
        />
      </div>

      {/* Tags */}
      <div className="flex flex-col gap-2">
        <FieldLabel>Tags</FieldLabel>
        <ComboboxInput
          createLabel="Add tag"
          multiple
          onCreateOption={onCreateTag}
          onValueChange={(ids) => setForm({ ...form, tagIds: ids })}
          options={boardTags.map((t) => ({
            color: t.color,
            label: t.name,
            value: t.id,
          }))}
          placeholder="Search or create tags…"
          value={form.tagIds}
        />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2">
        <FieldLabel>Body</FieldLabel>
        <MarkdownEditor
          onChange={(v) => setForm({ ...form, body: v })}
          onImageUpload={onImageUpload}
          rows={12}
          uploading={uploading}
          value={form.body}
        />
      </div>

      {/* Configuration section */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Configuration</SectionLabel>

        <div className="rounded-lg border border-border-default bg-surface-overlay/30 p-4">
          <div className="grid grid-cols-[1fr_1fr] gap-3">
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="edit-target-repo" required>
                Target Repository
              </FieldLabel>
              <ComboboxInput
                createLabel="Use"
                id="edit-target-repo"
                onCreateOption={(name) =>
                  setForm({ ...form, targetRepo: name })
                }
                onValueChange={(v) => setForm({ ...form, targetRepo: v })}
                options={repoOptions}
                placeholder="owner/repo"
                value={form.targetRepo}
              />
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="edit-target-branch" required>
                Branch
              </FieldLabel>
              <ComboboxInput
                createLabel="Use"
                id="edit-target-branch"
                onCreateOption={(name) =>
                  setForm({ ...form, targetBranch: name })
                }
                onValueChange={(v) => setForm({ ...form, targetBranch: v })}
                options={branchOptions}
                placeholder="main"
                value={form.targetBranch}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center gap-3 border-border-default border-t pt-5 *:w-1/2">
        <Button
          color="primary"
          disabled={
            !form.title.trim() ||
            !form.targetRepo.trim() ||
            !form.targetBranch.trim() ||
            loading
          }
          onClick={onSave}
          size="large"
        >
          {loading ? 'Saving…' : 'Save Changes'}
        </Button>
        <Button
          color="ghost"
          disabled={loading}
          onClick={onCancel}
          size="large"
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
  const [sessionId] = useState(() => crypto.randomUUID())

  // Image upload hooks
  const createUpload = useImageUpload({
    boardId: board?.id ?? '',
    sessionId,
  })
  const editUpload = useImageUpload({
    boardId: board?.id ?? '',
    taskId: task?.id,
  })

  // Derive unique repo/branch options from existing tasks
  const repoOptions = useMemo(() => {
    if (!board) return []
    const repos = new Set<string>()
    for (const col of board.columns) {
      for (const t of col.tasks) {
        if (t.targetRepo) repos.add(t.targetRepo)
      }
    }
    return Array.from(repos)
      .sort()
      .map((r) => ({ label: r, value: r }))
  }, [board])

  const branchOptions = useMemo(() => {
    if (!board) return []
    const branches = new Set<string>()
    for (const col of board.columns) {
      for (const t of col.tasks) {
        if (t.targetBranch) branches.add(t.targetBranch)
      }
    }
    return Array.from(branches)
      .sort()
      .map((b) => ({ label: b, value: b }))
  }, [board])

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
          action: 'idle',
          boardId: board.id,
          body: createForm.body || null,
          columnId: createTaskColumnId,
          sessionId,
          tagIds: createForm.tagIds.length > 0 ? createForm.tagIds : null,
          targetBranch: createForm.targetBranch.trim() || 'main',
          targetRepo: createForm.targetRepo.trim() || null,
          title: createForm.title.trim(),
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
            action: editForm.action || null,
            body: editForm.body,
            tagIds: editForm.tagIds,
            targetBranch: editForm.targetBranch.trim() || null,
            targetRepo: editForm.targetRepo.trim() || null,
            title: editForm.title.trim(),
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
      ;``
      const data = await graphqlClient.request<{
        dispatchAgent: Partial<Task>
      }>(DISPATCH_AGENT, {
        action,
        taskId: task.id,
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
      action: task.action ?? '',
      body: task.body ?? '',
      tagIds: task.tags?.map((t) => t.id) ?? [],
      targetBranch: task.targetBranch ?? 'main',
      targetRepo: task.targetRepo ?? '',
      title: task.title,
    })
    setIsEditing(true)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setEditForm(emptyForm)
  }

  const handleCreateTag = async (
    name: string,
    formSetter: React.Dispatch<React.SetStateAction<FormState>>,
  ) => {
    if (!board) return
    try {
      const data = await graphqlClient.request<{
        createTag: Tag
      }>(CREATE_TAG, {
        input: { boardId: board.id, color: hashToColor(name), name },
      })
      const newTag = data.createTag
      await refetchBoard()
      formSetter((prev) => ({ ...prev, tagIds: [...prev.tagIds, newTag.id] }))
    } catch (e) {
      console.error(e)
    }
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'New Task'
      : task?.id
        ? `Task #${task.id}`
        : loading
          ? 'Loading…'
          : 'Task'

  return (
    <Drawer
      onOpenChange={(open) => {
        if (!open) closeDrawer()
      }}
      open={drawerMode !== 'closed'}
      size="wide"
      title={drawerTitle}
    >
      {drawerMode === 'create' && (
        <CreateMode
          boardTags={board?.tags ?? []}
          branchOptions={branchOptions}
          form={createForm}
          loading={loading}
          onCreateTag={(name) => handleCreateTag(name, setCreateForm)}
          onImageUpload={createUpload.uploadImage}
          onSubmit={handleCreate}
          repoOptions={repoOptions}
          setForm={setCreateForm}
          uploading={createUpload.uploading}
        />
      )}

      {drawerMode === 'view' && loading && !task && (
        <div className="flex grow items-center justify-center">
          <span className="text-body-sm text-text-tertiary">Loading…</span>
        </div>
      )}

      {drawerMode === 'view' && task && !isEditing && (
        <ViewMode
          loading={loading}
          onArchive={handleArchive}
          onEdit={enterEdit}
          task={task}
        />
      )}

      {drawerMode === 'view' && task && isEditing && (
        <EditMode
          boardTags={board?.tags ?? []}
          branchOptions={branchOptions}
          form={editForm}
          loading={loading}
          onCancel={cancelEdit}
          onCreateTag={(name) => handleCreateTag(name, setEditForm)}
          onImageUpload={editUpload.uploadImage}
          onSave={handleSaveEdit}
          repoOptions={repoOptions}
          setForm={setEditForm}
          uploading={editUpload.uploading}
        />
      )}

      {/* Agent panel — view mode only, hidden during edit */}
      {drawerMode === 'view' && task && !isEditing && (
        <AgentPanel
          loading={loading}
          onCancel={handleCancelAgent}
          onDispatch={handleDispatch}
          onUpdateAction={handleUpdateAction}
          task={task}
        />
      )}

      {/* Agent log stream — visible when running or has been run */}
      {drawerMode === 'view' &&
        task &&
        !isEditing &&
        (task.agentStatus === 'RUNNING' || task.agentOutput) && (
          <AgentLogStream agentStatus={task.agentStatus} taskId={task.id} />
        )}

      {/* Timeline — view mode only, not during edit */}
      {drawerMode === 'view' && task && !isEditing && (
        <div className="flex flex-col gap-3 border-border-default border-t pt-5">
          <SectionLabel>Activity</SectionLabel>
          <TaskTimeline taskId={task.id} />
        </div>
      )}

      {/* Comments — view mode only, not during edit */}
      {drawerMode === 'view' && task && !isEditing && (
        <div className="flex flex-col gap-3 border-border-default border-t pt-5">
          <SectionLabel>Comments</SectionLabel>
          <TaskComments taskId={task.id} />
        </div>
      )}
    </Drawer>
  )
}
