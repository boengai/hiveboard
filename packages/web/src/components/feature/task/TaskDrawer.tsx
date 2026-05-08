import { useForm } from '@tanstack/react-form'
import type { ReactNode } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import {
  ArchiveIcon,
  Avatar,
  Badge,
  Button,
  CheckIcon,
  ComboboxInput,
  CopyIcon,
  Drawer,
  FieldError,
  FieldLabel,
  MarkdownEditor,
  MarkdownPreview,
  PencilIcon,
  RefreshIcon,
  SelectInput,
  TextAreaInput,
  TextInput,
} from '@/components/common'
import { ChevronIcon, GitHubIcon } from '@/components/common/icon'
import {
  ARCHIVE_TASK,
  CANCEL_AGENT,
  CONTINUE_FAILED_TASK,
  CREATE_TAG,
  CREATE_TASK,
  GET_BOARD,
  GET_TASK,
  GET_TASK_TIMELINE,
  graphqlClient,
  RUN_AGENT,
  UNARCHIVE_TASK,
  UPDATE_TASK,
} from '@/graphql'
import { useImageUpload, usePlaybooks } from '@/hooks'
import { type TaskFormValues, taskFormSchema } from '@/schemas'
import { useBoardStore } from '@/store'
import type {
  ActionColor,
  AgentPanelProps,
  CreateModeProps,
  EditModeProps,
  RawTimelineEvent,
  Tag,
  Task,
  ViewModeProps,
} from '@/types'
import { hashToColor, tv } from '@/utils'
import { AgentRunLog } from '../agent/AgentRunLog'
import { TaskComments } from './TaskComments'
import { TaskDependencies } from './TaskDependencies'
import { TaskEventHistory, timeAgo } from './TaskEventHistory'
import { TaskMessages } from './TaskMessages'
import { TaskProgress } from './TaskProgress'
import { TaskScratchpad } from './TaskScratchpad'
import { TaskSecrets } from './TaskSecrets'
import { TaskSubtasks } from './TaskSubtasks'
import { TaskTimeBox } from './TaskTimeBox'
import { TaskTimeline } from './TaskTimeline'
import { TaskVerification } from './TaskVerification'

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

function agentStatusColor(status: string): ActionColor {
  switch (status) {
    case 'QUEUED':
      return 'warning'
    case 'RUNNING':
      return 'info'
    case 'BLOCKED':
      return 'honey'
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

const DRAWER_SECTION_STORAGE_KEY = 'hiveboard.drawer.collapsed-sections'

let sectionMapCache: Record<string, boolean> | null = null

function readSectionMap(): Record<string, boolean> {
  if (sectionMapCache) return sectionMapCache
  if (typeof window === 'undefined') {
    sectionMapCache = {}
    return sectionMapCache
  }
  try {
    const raw = window.localStorage.getItem(DRAWER_SECTION_STORAGE_KEY)
    sectionMapCache = raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    sectionMapCache = {}
  }
  return sectionMapCache
}

function writeSectionMap(name: string, value: boolean) {
  const map = readSectionMap()
  map[name] = value
  try {
    window.localStorage.setItem(DRAWER_SECTION_STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function useSectionOpen(name: string, defaultOpen: boolean) {
  const [open, setOpen] = useState<boolean>(
    () => readSectionMap()[name] ?? defaultOpen,
  )
  const onToggle = useCallback(
    (next: boolean) => {
      setOpen(next)
      writeSectionMap(name, next)
    },
    [name],
  )
  return [open, onToggle] as const
}

function CollapsibleSection({
  name,
  label,
  defaultOpen = false,
  children,
}: {
  name: string
  label: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useSectionOpen(name, defaultOpen)
  return (
    <details
      className="group flex flex-col gap-3 border-border-default border-t pt-5"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      open={open}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-text-tertiary marker:hidden hover:text-text-primary">
        <span className="inline-flex -rotate-90 transition-transform group-open:rotate-0">
          <ChevronIcon size={10} />
        </span>
        <SectionLabel>{label}</SectionLabel>
      </summary>
      <div className="flex flex-col gap-3">{children}</div>
    </details>
  )
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
      agentInstruction: '',
      body: '## Description\n',
      plan: '',
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
  onContinueTask,
  onRequiredSecretsChanged,
  boardSecrets,
  initialTimelineEntries,
}: ViewModeProps) => {
  // state
  const [continueInstruction, setContinueInstruction] = useState('')
  const [continuing, setContinuing] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopyTaskId = () => {
    if (!task?.id) return
    navigator.clipboard.writeText(task.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleContinue = async () => {
    setContinuing(true)
    try {
      await onContinueTask(continueInstruction.trim() || null)
      setContinueInstruction('')
    } finally {
      setContinuing(false)
    }
  }

  const headerRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  // Visible inner height of the drawer's scroll viewport, computed from the
  // scroll container's clientHeight minus its vertical padding. We need this
  // (rather than 100vh) because the drawer is not the full viewport — its
  // content area is wrapped by Vaul's close-bar and the drawer's own padding.
  const [scrollViewportHeight, setScrollViewportHeight] = useState(0)

  useLayoutEffect(() => {
    const headerNode = headerRef.current
    if (!headerNode) return
    // The scroll container is the drawer's content area (overflow-y: auto), two
    // levels up from the sticky header: header → outer wrapper → scroll container.
    const scrollContainer = headerNode.parentElement?.parentElement ?? null

    const measure = () => {
      setHeaderHeight(headerNode.clientHeight)
      if (scrollContainer) {
        const styles = getComputedStyle(scrollContainer)
        const paddingY =
          parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)
        setScrollViewportHeight(scrollContainer.clientHeight - paddingY)
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(headerNode)
    if (scrollContainer) ro.observe(scrollContainer)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="flex grow flex-col">
      {/* Sticky header — title, meta, tags, agent panel, continue-from-failure */}
      <div
        className="sticky top-0 z-10 flex flex-col gap-6 bg-surface-raised pb-6 border-b border-border-default"
        ref={headerRef}
      >
        {/* Header area */}
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-semibold text-heading-3 text-text-primary leading-tight">
              {task.title}
            </h2>
            <div className="flex shrink-0 items-center gap-1 pt-0.5">
              <Button
                aria-label={copied ? 'Task ID copied' : 'Copy task ID'}
                onClick={handleCopyTaskId}
                size="small"
                title={copied ? 'Copied!' : 'Copy full task ID'}
                variant="ghost"
              >
                {copied ? (
                  <span className="text-success-400">
                    <CheckIcon size={12} />
                  </span>
                ) : (
                  <CopyIcon size={12} />
                )}
              </Button>
              {task.column?.name !== 'Done' && (
                <Button
                  onClick={onEdit}
                  size="small"
                  title="Edit task"
                  variant="ghost"
                >
                  <PencilIcon size={16} />
                </Button>
              )}
              <Button
                disabled={loading}
                onClick={onArchive}
                size="small"
                title={task.archived ? 'Unarchive task' : 'Archive task'}
                variant="ghost"
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
                <a
                  className="inline-flex items-center gap-1 rounded-md bg-surface-overlay px-2 py-0.5 font-mono text-body-xs text-text-tertiary"
                  href={`https://github.com/${task.targetRepo}`}
                  rel="noopener"
                  target="_blank"
                >
                  <GitHubIcon />
                  <span>{task.targetRepo}</span>
                </a>
              </div>
            )}
            {task.prUrl && (
              <a
                className="inline-flex items-center gap-1 rounded-md bg-info-400/10 px-2 py-0.5 font-medium text-body-xs text-info-400 transition-colors hover:bg-info-400/20"
                href={task.prUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                PR #{task.prUrl.match(/\/pull\/(\d+)/)?.[1] ?? '?'}
              </a>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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

        {/* Agent panel */}
        {task.column?.name !== 'Done' && (
          <AgentPanel
            loading={loading}
            onInterruptAgent={onInterruptAgent}
            onUpdateAction={onUpdateAction}
            task={task}
          />
        )}

        {/* Continue from failure */}
        {task.agentStatus === 'FAILED' && (
          <div className="flex flex-col gap-2 rounded-md border border-border-default bg-surface-2 p-3">
            <SectionLabel>Continue from failure</SectionLabel>
            <textarea
              className="rounded border border-border-default bg-surface-1 p-2 font-mono text-body-xs"
              onChange={(e) => setContinueInstruction(e.target.value)}
              placeholder="Optional: extra guidance for the next attempt"
              rows={2}
              value={continueInstruction}
            />
            <span className="self-start">
              <Button
                color="primary"
                disabled={continuing || loading}
                onClick={handleContinue}
                size="small"
                type="button"
                variant="solid"
              >
                {continuing ? 'Continuing…' : 'Continue'}
              </Button>
            </span>
          </div>
        )}
      </div>

      {/* Body grid — single column below xl, two columns at xl+ */}
      <div
        className="grid grid-cols-1 gap-6 pt-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
        style={
          {
            '--col-max-h':
              scrollViewportHeight > 0
                ? `${scrollViewportHeight - headerHeight}px`
                : `calc(100dvh - ${headerHeight}px)`,
          } as React.CSSProperties
        }
      >
        {/* LEFT COLUMN — writing surfaces */}
        <div className="flex flex-col gap-6 xl:overflow-y-auto xl:max-h-[var(--col-max-h)]">
          {/* Body */}
          {task.body ? (
            <MarkdownPreview content={task.body} />
          ) : (
            <p className="text-body-sm text-text-tertiary italic">No description</p>
          )}

          {/* Plan (agent-generated, editable) */}
          <div>
            <h3 className="text-body-sm font-medium text-text-secondary mb-2">
              Plan
              <span className="text-text-tertiary font-normal ml-2">
                (agent-generated)
              </span>
            </h3>
            {task.plan ? (
              <MarkdownPreview content={task.plan} />
            ) : (
              <p className="text-body-sm text-text-tertiary italic">
                No plan yet — run the <code>plan</code> action to generate one.
              </p>
            )}
          </div>

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

          <CollapsibleSection defaultOpen label="Messages" name="messages">
            <TaskMessages
              agentStatus={task.agentStatus}
              currentQuestion={task.currentQuestion ?? null}
              initialMessages={task.messages ?? []}
              taskId={task.id}
            />
          </CollapsibleSection>

          {task.column?.name !== 'Done' && (
            <CollapsibleSection label="Comments" name="comments">
              <TaskComments initialComments={task.comments} taskId={task.id} />
            </CollapsibleSection>
          )}
        </div>

        {/* RIGHT COLUMN — metadata + telemetry */}
        <div className="flex flex-col gap-6 xl:overflow-y-auto xl:max-h-[var(--col-max-h)]">
          <CollapsibleSection defaultOpen label="Dependencies" name="dependencies">
            <TaskDependencies
              agentStatus={task.agentStatus}
              blockers={task.blockers ?? []}
              blockReason={task.blockReason ?? null}
              dependents={task.dependents ?? []}
              taskId={task.id}
            />
          </CollapsibleSection>
          <CollapsibleSection label="Subtasks" name="subtasks">
            <TaskSubtasks
              parentTask={task.parentTask ?? null}
              subtasks={task.subtasks ?? []}
              taskId={task.id}
            />
          </CollapsibleSection>
          <CollapsibleSection label="Time Box" name="time-box">
            <TaskTimeBox
              agentStatus={task.agentStatus}
              blockReason={task.blockReason ?? null}
              taskId={task.id}
              timeBoxMs={task.timeBoxMs ?? null}
              timeBoxRemainingMs={task.timeBoxRemainingMs ?? null}
              timeBoxStartedAt={task.timeBoxStartedAt ?? null}
            />
          </CollapsibleSection>
          <CollapsibleSection label="Secrets" name="secrets">
            <TaskSecrets
              boardSecrets={boardSecrets}
              onRequiredChanged={onRequiredSecretsChanged}
              task={task}
            />
          </CollapsibleSection>
          <CollapsibleSection label="Scratchpad" name="scratchpad">
            <TaskScratchpad
              initialContent={task.scratchpad ?? ''}
              taskId={task.id}
            />
          </CollapsibleSection>
          <CollapsibleSection label="Run Log" name="run-log">
            <AgentRunLog agentRuns={task.agentRuns ?? []} taskId={task.id} />
          </CollapsibleSection>
          <CollapsibleSection label="Progress" name="progress">
            <TaskProgress
              agentStatus={task.agentStatus}
              initialEntries={[]}
              taskId={task.id}
            />
          </CollapsibleSection>
          <CollapsibleSection label="Timeline" name="timeline">
            <TaskTimeline
              initialSnapshots={task.workspaceSnapshots ?? []}
              taskId={task.id}
            />
          </CollapsibleSection>
          <CollapsibleSection label="Verification" name="verification">
            <TaskVerification
              initialRuns={task.verificationRuns ?? []}
              taskId={task.id}
              verifyAttemptCount={task.verifyAttemptCount ?? 0}
            />
          </CollapsibleSection>
          <CollapsibleSection
            defaultOpen
            label="Event History"
            name="event-history"
          >
            <TaskEventHistory
              initialEntries={initialTimelineEntries ?? []}
              taskId={task.id}
            />
          </CollapsibleSection>
        </div>
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
  const [instruction, setInstruction] = useState(task.agentInstruction ?? '')
  const { playbooks } = usePlaybooks()
  const [playbookFireCount, setPlaybookFireCount] = useState(0)

  useEffect(() => {
    setInstruction(task.agentInstruction ?? '')
  }, [task.agentInstruction])

  const playbookOptions = useMemo(() => {
    const activePlaybooks = (playbooks ?? []).filter((p) => !p.archived)
    return activePlaybooks.map((pb) => ({
      label: `${pb.displayName} · v${pb.currentVersion.versionNumber}`,
      value: `playbook:${pb.name}`,
    }))
  }, [playbooks])

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

      {/* Agent instruction */}
      <div className="flex flex-col gap-1">
        <span className="font-medium text-body-xs text-text-tertiary">
          Instruction
        </span>
        <TextAreaInput
          disabled={isAgentActive || loading}
          onChange={setInstruction}
          placeholder="Optional instruction for the agent…"
          rows={2}
          value={instruction}
        />
      </div>

      {/* Actions: built-ins as buttons, playbooks behind a select */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          color="info"
          disabled={isAgentActive || loading}
          onClick={() => onUpdateAction('plan', instruction || undefined)}
          size="small"
          type="button"
          variant="secondary"
        >
          Plan
        </Button>
        <Button
          color="success"
          disabled={isAgentActive || loading}
          onClick={() => onUpdateAction('implement', instruction || undefined)}
          size="small"
          type="button"
        >
          Implement
        </Button>
        <Button
          color="warning"
          disabled={isAgentActive || loading}
          onClick={() => onUpdateAction('revise', instruction || undefined)}
          size="small"
          type="button"
          variant="secondary"
        >
          Revise
        </Button>
        {playbookOptions.length > 0 && (
          <div className="ml-auto min-w-48">
            <SelectInput
              disabled={isAgentActive || loading}
              groups={[{ label: 'Playbooks', options: playbookOptions }]}
              key={playbookFireCount}
              onValueChange={(action) => {
                onUpdateAction(action, instruction || undefined)
                setPlaybookFireCount((n) => n + 1)
              }}
              placeholder="Run playbook…"
              value={undefined}
            />
          </div>
        )}
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

      {/* Plan (agent-generated, editable) */}
      <form.Field name="plan">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel>Plan (agent-generated)</FieldLabel>
            <MarkdownEditor
              onChange={field.handleChange}
              onImageUpload={onImageUpload}
              rows={8}
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

      {/* Agent Instruction */}
      <form.Field name="agentInstruction">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="edit-agent-instruction">
              Agent Instruction
            </FieldLabel>
            <TextInput
              id="edit-agent-instruction"
              onChange={field.handleChange}
              placeholder="Optional instruction for the agent…"
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>

      {/* Footer — sticky to the bottom of the scrollable drawer body so the
          Save/Cancel actions are always reachable, even when the form is
          longer than the viewport. The negative inset margins extend the
          footer + its border edge-to-edge past the parent's `p-5` padding. */}
      <div className="-mx-5 -mb-5 sticky -bottom-5 z-10 mt-auto flex items-center gap-3 border-border-default border-t bg-surface-raised p-5 *:w-1/2">
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
          disabled={loading}
          onClick={onCancel}
          size="large"
          type="button"
          variant="ghost"
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
  const drawerMode = useBoardStore((s) => s.drawerMode)
  const selectedTaskId = useBoardStore((s) => s.selectedTaskId)
  const createTaskColumnId = useBoardStore((s) => s.createTaskColumnId)
  const closeDrawer = useBoardStore((s) => s.closeDrawer)
  const setBoard = useBoardStore((s) => s.setBoard)
  const board = useBoardStore((s) => s.board)

  const [task, setTask] = useState<Task | null>(null)
  const [timelineEntries, setTimelineEntries] = useState<
    RawTimelineEvent[] | null
  >(null)
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

  // Fetch task + timeline in parallel when opening in view mode so the
  // Event History section doesn't wait for GET_TASK to finish first.
  useEffect(() => {
    if (drawerMode === 'view' && selectedTaskId) {
      let cancelled = false
      setTask(null)
      setTimelineEntries(null)
      startTransition(async () => {
        const taskPromise = graphqlClient
          .request<{ task: Task }>(GET_TASK, { id: selectedTaskId })
          .then((data) => {
            if (!cancelled) setTask(data.task)
          })
          .catch((err) => {
            if (!cancelled) console.error(err)
          })
        const timelinePromise = graphqlClient
          .request<{ taskTimeline: RawTimelineEvent[] }>(GET_TASK_TIMELINE, {
            taskId: selectedTaskId,
          })
          .then((data) => {
            if (!cancelled) setTimelineEntries(data.taskTimeline)
          })
          .catch((err) => {
            if (!cancelled) console.error(err)
          })
        await Promise.all([taskPromise, timelinePromise])
      })
      return () => {
        cancelled = true
      }
    }
  }, [drawerMode, selectedTaskId])

  // Keep local task state in sync with real-time board subscription updates
  useEffect(() => {
    if (!selectedTaskId) return
    const unsubscribe = useBoardStore.subscribe((state) => {
      for (const col of state.board?.columns ?? []) {
        const updated = col.tasks.find((t) => t.id === selectedTaskId)
        if (updated) {
          setTask((prev) => {
            if (!prev) return prev
            // Merge subscription data into local task to preserve fields
            // only present from GET_TASK (e.g. comments)
            if (prev.updatedAt === updated.updatedAt) return prev
            return { ...prev, ...updated }
          })
          return
        }
      }
    })
    return unsubscribe
  }, [selectedTaskId])

  // Reset local state on close
  useEffect(() => {
    if (drawerMode === 'closed') {
      setIsEditing(false)
      setTask(null)
      setTimelineEntries(null)
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
              agentInstruction: values.agentInstruction || null,
              body: values.body,
              plan: values.plan,
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

  const handleUpdateAction = (action: string, instruction?: string) => {
    if (!task) return
    startTransition(async () => {
      try {
        const data = await graphqlClient.request<{ runAgent: Task }>(
          RUN_AGENT,
          {
            action,
            instruction: instruction || null,
            taskId: task.id,
          },
        )
        setTask({ ...task, ...data.runAgent })
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

  const handleContinueTask = async (instruction: string | null) => {
    if (!task) return
    try {
      const data = await graphqlClient.request<{
        continueFailedTask: Partial<Task>
      }>(CONTINUE_FAILED_TASK, {
        instruction,
        taskId: task.id,
      })
      setTask({ ...task, ...data.continueFailedTask })
      await refetchBoard()
    } catch (e) {
      console.error(e)
    }
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
      : task?.title
        ? task.title
        : task?.id
          ? `Task #${task.id}`
          : isPending
            ? 'Loading…'
            : 'Task'

  // Build edit initial values from current task
  const editInitialValues: TaskFormValues | null = task
    ? {
        agentInstruction: task.agentInstruction ?? '',
        body: task.body ?? '',
        plan: task.plan ?? '',
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
      size="xl"
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
          boardSecrets={board?.secrets ?? []}
          initialTimelineEntries={timelineEntries}
          loading={isPending}
          onArchive={handleArchive}
          onContinueTask={handleContinueTask}
          onEdit={enterEdit}
          onInterruptAgent={handleInterruptAgent}
          onRequiredSecretsChanged={(next) =>
            setTask((prev) => (prev ? { ...prev, ...next } : prev))
          }
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
