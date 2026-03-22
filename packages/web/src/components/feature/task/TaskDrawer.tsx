import { useForm } from '@tanstack/react-form'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
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
  GET_BOARD,
  GET_TASK,
  graphqlClient,
  UNARCHIVE_TASK,
  UPDATE_TASK,
} from '@/graphql'
import { useImageUpload } from '@/hooks/useImageUpload'
import type { TaskFormValues } from '@/schemas/task'
import { taskFormSchema } from '@/schemas/task'
import { type Tag, type Task, useBoardStore } from '@/store'
import type {
  ActionColor,
  AgentPanelProps,
  CreateModeProps,
  EditModeProps,
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
  { label: 'Implement', value: 'implement' },
  { label: 'Implement E2E', value: 'implement-e2e' },
  { label: 'Revise', value: 'revise' },
]

function actionColor(action: string | null): ActionColor {
  switch (action) {
    case 'plan':
      return 'info'
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

const FieldError = ({
  errors,
}: {
  errors: Array<string | { message: string } | undefined>
}) => {
  const first = errors.find((e) => e != null)
  if (!first) return null
  const msg = typeof first === 'string' ? first : first.message
  return <span className="text-body-xs text-error-400">{msg}</span>
}

const CreateMode = ({
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

  const form = useForm({
    defaultValues: {
      action: '',
      body: '## Description\n',
      tagIds: [] as string[],
      targetBranch: 'main',
      targetRepo: '',
      title: '',
    },
    onSubmit: ({ value }) => {
      onSubmit(value)
    },
    validators: {
      onSubmit: taskFormSchema,
    },
  })

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  return (
    <form
      className="flex grow flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
    >
      {/* Title */}
      <form.Field name="title">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="create-title" required>
              Title
            </FieldLabel>
            <TextInput
              id="create-title"
              onChange={field.handleChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  form.handleSubmit()
                }
              }}
              placeholder="Task title"
              ref={titleRef}
              value={field.state.value}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>

      {/* Tags */}
      <form.Field name="tagIds">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel>Tags</FieldLabel>
            <ComboboxInput
              createLabel="Add tag"
              multiple
              onCreateOption={(name) =>
                onCreateTag(name, (newIds) =>
                  field.handleChange([...field.state.value, ...newIds]),
                )
              }
              onValueChange={field.handleChange}
              options={boardTags.map((t) => ({
                color: t.color,
                label: t.name,
                value: t.id,
              }))}
              placeholder="Search or create tags…"
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>

      {/* Body */}
      <form.Field name="body">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel>Body</FieldLabel>
            <MarkdownEditor
              onChange={field.handleChange}
              onImageUpload={onImageUpload}
              placeholder="Optional description…"
              rows={12}
              uploading={uploading}
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>

      {/* Target config */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Configuration</SectionLabel>
        <div className="rounded-lg border border-border-default bg-surface-overlay/30 p-4">
          <div className="grid grid-cols-[1fr_1fr] gap-3">
            <form.Field name="targetRepo">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <FieldLabel htmlFor="create-target-repo" required>
                    Target Repository
                  </FieldLabel>
                  <ComboboxInput
                    createLabel="Use"
                    id="create-target-repo"
                    onCreateOption={(name) => field.handleChange(name)}
                    onValueChange={field.handleChange}
                    options={repoOptions}
                    placeholder="owner/repo"
                    value={field.state.value}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name="targetBranch">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <FieldLabel htmlFor="create-target-branch" required>
                    Branch
                  </FieldLabel>
                  <ComboboxInput
                    createLabel="Use"
                    id="create-target-branch"
                    onCreateOption={(name) => field.handleChange(name)}
                    onValueChange={field.handleChange}
                    options={branchOptions}
                    placeholder="main"
                    value={field.state.value}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto border-border-default border-t pt-5">
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button
              block
              color="primary"
              disabled={loading || isSubmitting}
              type="submit"
            >
              {loading || isSubmitting ? 'Creating…' : 'Create Task'}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  )
}

const ViewMode = ({
  task,
  onEdit,
  onArchive,
  loading,
  onInterruptAgent,
  onUpdateAction,
}: ViewModeProps) => {
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
      <AgentPanel
        loading={loading}
        onInterruptAgent={onInterruptAgent}
        onUpdateAction={onUpdateAction}
        task={task}
      />
      {(task.agentStatus === 'RUNNING' || task.agentOutput) && (
        <AgentLogStream agentStatus={task.agentStatus} taskId={task.id} />
      )}
      <div className="flex flex-col gap-3 border-border-default border-t pt-5">
        <SectionLabel>Activity</SectionLabel>
        <TaskTimeline taskId={task.id} />
      </div>
      <div className="flex flex-col gap-3 border-border-default border-t pt-5">
        <SectionLabel>Comments</SectionLabel>
        <TaskComments taskId={task.id} />
      </div>
    </div>
  )
}

const AgentPanel = ({
  task,
  onInterruptAgent,
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
        <div className="flex items-center justify-center gap-2">
          <Badge color={agentStatusColor(task.agentStatus)}>
            {task.agentStatus}
          </Badge>
          {isAgentActive && (
            <Button
              color="danger"
              disabled={loading}
              onClick={onInterruptAgent}
            >
              Cancel
            </Button>
          )}
        </div>
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
      </div>
    </div>
  )
}

const EditMode = ({
  initialValues,
  onSubmit,
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

  const form = useForm({
    defaultValues: initialValues,
    onSubmit: ({ value }) => {
      onSubmit(value)
    },
    validators: {
      onSubmit: taskFormSchema,
    },
  })

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  return (
    <form
      className="flex grow flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
    >
      {/* Title */}
      <form.Field name="title">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="edit-title" required>
              Title
            </FieldLabel>
            <TextInput
              id="edit-title"
              onChange={field.handleChange}
              ref={titleRef}
              value={field.state.value}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>

      {/* Tags */}
      <form.Field name="tagIds">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel>Tags</FieldLabel>
            <ComboboxInput
              createLabel="Add tag"
              multiple
              onCreateOption={(name) =>
                onCreateTag(name, (newIds) =>
                  field.handleChange([...field.state.value, ...newIds]),
                )
              }
              onValueChange={field.handleChange}
              options={boardTags.map((t) => ({
                color: t.color,
                label: t.name,
                value: t.id,
              }))}
              placeholder="Search or create tags…"
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>

      {/* Body */}
      <form.Field name="body">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel>Body</FieldLabel>
            <MarkdownEditor
              onChange={field.handleChange}
              onImageUpload={onImageUpload}
              rows={12}
              uploading={uploading}
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>

      {/* Configuration section */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Configuration</SectionLabel>

        <div className="rounded-lg border border-border-default bg-surface-overlay/30 p-4">
          <div className="grid grid-cols-[1fr_1fr] gap-3">
            <form.Field name="targetRepo">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <FieldLabel htmlFor="edit-target-repo" required>
                    Target Repository
                  </FieldLabel>
                  <ComboboxInput
                    createLabel="Use"
                    id="edit-target-repo"
                    onCreateOption={(name) => field.handleChange(name)}
                    onValueChange={field.handleChange}
                    options={repoOptions}
                    placeholder="owner/repo"
                    value={field.state.value}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name="targetBranch">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <FieldLabel htmlFor="edit-target-branch" required>
                    Branch
                  </FieldLabel>
                  <ComboboxInput
                    createLabel="Use"
                    id="edit-target-branch"
                    onCreateOption={(name) => field.handleChange(name)}
                    onValueChange={field.handleChange}
                    options={branchOptions}
                    placeholder="main"
                    value={field.state.value}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center gap-3 border-border-default border-t pt-5 *:w-1/2">
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button
              color="primary"
              disabled={loading || isSubmitting}
              size="large"
              type="submit"
            >
              {loading || isSubmitting ? 'Saving…' : 'Save Changes'}
            </Button>
          )}
        </form.Subscribe>
        <Button
          color="ghost"
          disabled={loading}
          onClick={onCancel}
          size="large"
          type="button"
        >
          Cancel
        </Button>
      </div>
    </form>
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
  const [isPending, startTransition] = useTransition()

  const [isEditing, setIsEditing] = useState(false)
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
      startTransition(async () => {
        try {
          const data = await graphqlClient.request<{ task: Task }>(GET_TASK, {
            id: selectedTaskId,
          })
          if (!cancelled) setTask(data.task)
        } catch (err) {
          if (!cancelled) console.error(err)
        }
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

  const handleCreate = (values: TaskFormValues) => {
    if (!createTaskColumnId || !board) return
    startTransition(async () => {
      try {
        await graphqlClient.request(CREATE_TASK, {
          input: {
            boardId: board.id,
            body: values.body || null,
            columnId: createTaskColumnId,
            sessionId,
            tagIds: values.tagIds.length > 0 ? values.tagIds : null,
            targetBranch: values.targetBranch.trim() || 'main',
            targetRepo: values.targetRepo.trim() || null,
            title: values.title.trim(),
          },
        })
        await refetchBoard()
        closeDrawer()
      } catch (e) {
        console.error(e)
      }
    })
  }

  const handleSaveEdit = (values: TaskFormValues) => {
    if (!task) return
    startTransition(async () => {
      try {
        const updated = await graphqlClient.request<{ updateTask: Task }>(
          UPDATE_TASK,
          {
            id: task.id,
            input: {
              action: values.action || null,
              body: values.body,
              tagIds: values.tagIds,
              targetBranch: values.targetBranch.trim() || null,
              targetRepo: values.targetRepo.trim() || null,
              title: values.title.trim(),
            },
          },
        )
        setTask(updated.updateTask)
        await refetchBoard()
        setIsEditing(false)
      } catch (e) {
        console.error(e)
      }
    })
  }

  const handleArchive = () => {
    if (!task) return
    startTransition(async () => {
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
      }
    })
  }

  const handleUpdateAction = (action: string) => {
    if (!task) return
    startTransition(async () => {
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
      }
    })
  }

  const handleInterruptAgent = () => {
    if (!task) return
    startTransition(async () => {
      try {
        const data = await graphqlClient.request<{
          cancelAgent: Partial<Task>
        }>(CANCEL_AGENT, {
          taskId: task.id,
        })
        setTask({ ...task, ...data.cancelAgent })
      } catch (e) {
        console.error(e)
      }
    })
  }

  const enterEdit = () => {
    if (!task) return
    setIsEditing(true)
  }

  const cancelEdit = () => {
    setIsEditing(false)
  }

  const handleCreateTag = async (
    name: string,
    updateTagIds: (ids: string[]) => void,
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
      // The caller passes the current tagIds + new tag via the form field updater
      updateTagIds([newTag.id])
    } catch (e) {
      console.error(e)
    }
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'New Task'
      : task?.id
        ? `Task #${task.id}`
        : isPending
          ? 'Loading…'
          : 'Task'

  // Build edit initial values from current task
  const editInitialValues: TaskFormValues | null = task
    ? {
        action: task.action ?? '',
        body: task.body ?? '',
        tagIds: task.tags?.map((t) => t.id) ?? [],
        targetBranch: task.targetBranch ?? 'main',
        targetRepo: task.targetRepo ?? '',
        title: task.title,
      }
    : null

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
          loading={isPending}
          onCreateTag={handleCreateTag}
          onImageUpload={createUpload.uploadImage}
          onSubmit={handleCreate}
          repoOptions={repoOptions}
          uploading={createUpload.uploading}
        />
      )}
      {drawerMode === 'view' && isPending && !task && (
        <div className="flex grow items-center justify-center">
          <span className="text-body-sm text-text-tertiary">Loading…</span>
        </div>
      )}
      {drawerMode === 'view' && task && !isEditing && (
        <ViewMode
          loading={isPending}
          onArchive={handleArchive}
          onEdit={enterEdit}
          onInterruptAgent={handleInterruptAgent}
          onUpdateAction={handleUpdateAction}
          task={task}
        />
      )}
      {drawerMode === 'view' && task && isEditing && editInitialValues && (
        <EditMode
          boardTags={board?.tags ?? []}
          branchOptions={branchOptions}
          initialValues={editInitialValues}
          key={task.id}
          loading={isPending}
          onCancel={cancelEdit}
          onCreateTag={handleCreateTag}
          onImageUpload={editUpload.uploadImage}
          onSubmit={handleSaveEdit}
          repoOptions={repoOptions}
          uploading={editUpload.uploading}
        />
      )}
    </Drawer>
  )
}
