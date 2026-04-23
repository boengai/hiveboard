import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { m } from 'motion/react'
import { useEffect, useState } from 'react'
import { Avatar, CheckIcon, SpinnerIcon, XMarkIcon } from '@/components/common'
import { GitHubIcon } from '@/components/common/icon'
import { subscribe, TASK_PROGRESS_ADDED_SUBSCRIPTION } from '@/graphql'
import { useBoardStore } from '@/store'
import type { Task, TaskCardProps } from '@/types'
import type { TaskProgressEntry } from '@/types/models'
import { tv } from '@/utils'

const parseActionLabel = (
  status: Task['agentStatus'],
  action: Task['action'],
) => {
  switch (status) {
    case 'QUEUED':
      return 'In Queue'
    case 'SUCCESS':
      switch (action) {
        case 'implement':
          return 'Implemented'
        case 'plan':
          return 'Planned'
        case 'revise':
          return 'Revised'
        default:
          return 'Completed'
      }
    case 'FAILED':
      return 'Failed'
    case 'BLOCKED':
      return 'Waiting on you'
    case 'RUNNING':
      switch (action) {
        case 'implement':
          return 'Implementing'
        case 'plan':
          return 'Planning'
        case 'revise':
          return 'Revising'
        default:
          return 'Unknown'
      }
    default:
      switch (action) {
        case 'implement':
          return 'Implement'
        case 'plan':
          return 'Plan'
        case 'revise':
          return 'Revise'
        default:
          return 'Unknown'
      }
  }
}

// Action badge styles
const actionBadge = tv({
  base: 'flex items-center justify-center gap-1 self-start rounded-full px-1.5 py-0.5 font-medium text-body-xs',
  variants: {
    action: {
      implement: 'bg-success-400/15 text-success-400',
      plan: 'bg-info-400/15 text-info-400',
      revise: 'bg-warning-400/15 text-warning-400',
    } as Record<string, string>,
  },
})

function AgentStatusDot({
  status,
  verifyAttemptCount,
}: {
  status: Task['agentStatus']
  verifyAttemptCount: number
}) {
  if (status === 'IDLE') {
    return (
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-600" />
    )
  }
  if (status === 'QUEUED' && verifyAttemptCount > 0) {
    return (
      <span
        className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-warning-400/20 font-bold text-warning-400 text-xs"
        title={`Retrying verification (attempt ${verifyAttemptCount})`}
      >
        ↻
      </span>
    )
  }
  if (status === 'FAILED' && verifyAttemptCount > 0) {
    return (
      <span
        className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-error-400/20 font-bold text-error-400 text-xs"
        title="Verification failed; human action needed"
      >
        !
      </span>
    )
  }
  if (status === 'QUEUED') {
    return (
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-honey-400" />
    )
  }
  if (status === 'RUNNING') {
    return (
      <span className="inline-flex h-3 w-3 animate-spin text-info-400">
        <SpinnerIcon size={12} />
      </span>
    )
  }
  if (status === 'BLOCKED') {
    return (
      <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-honey-400/20 font-bold text-honey-300 text-xs">
        ?
      </span>
    )
  }
  if (status === 'SUCCESS') {
    return (
      <span className="inline-flex text-success-400">
        <CheckIcon size={12} />
      </span>
    )
  }
  if (status === 'FAILED') {
    return (
      <span className="inline-flex text-error-400">
        <XMarkIcon size={12} />
      </span>
    )
  }
  return null
}

export function TaskCard({ task, column }: TaskCardProps) {
  const openDrawerView = useBoardStore((s) => s.openDrawerView)

  const [latestProgress, setLatestProgress] =
    useState<TaskProgressEntry | null>(null)

  useEffect(() => {
    if (task.agentStatus !== 'RUNNING') {
      setLatestProgress(null)
      return
    }
    const dispose = subscribe<{ taskProgressAdded: TaskProgressEntry }>(
      TASK_PROGRESS_ADDED_SUBSCRIPTION,
      { taskId: task.id },
      (data) => {
        if (data.taskProgressAdded?.taskId !== task.id) return
        setLatestProgress(data.taskProgressAdded)
      },
    )
    return dispose
  }, [task.id, task.agentStatus])

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const badgeClass = task.action
    ? actionBadge({ action: task.action as keyof typeof actionBadge })
    : null

  const unresolvedBlockers =
    task.blockers?.filter(
      (b: { agentStatus: string }) => b.agentStatus !== 'SUCCESS',
    ) ?? []
  const hasUnresolvedBlockers = unresolvedBlockers.length > 0
  const parentTagColor = task.parentTask?.tags?.[0]?.color

  return (
    <m.div
      ref={setNodeRef}
      style={{
        ...style,
        ...(parentTagColor
          ? { borderLeft: `3px solid ${parentTagColor}` }
          : {}),
      }}
      {...attributes}
      {...listeners}
      className={`flex cursor-pointer select-none flex-col gap-1 rounded-md border border-border-default bg-surface-raised p-3 opacity-100 hover:border-border-hover hover:shadow-xs data-[dragging=true]:opacity-40 data-[dragging=true]:shadow-md ${task.agentStatus === 'BLOCKED' ? 'ring-1 ring-honey-400/60' : ''}`}
      data-dragging={isDragging ? 'true' : 'false'}
      onClick={() => openDrawerView(task.id)}
      whileHover={{ y: -1 }}
    >
      {/* Header row, Agent status + Action badge — hidden in Done column */}
      {badgeClass && column && column.name !== 'Done' && (
        <div className={badgeClass}>
          {/* Agent status — hidden when idle */}
          {task.agentStatus !== 'IDLE' && (
            <AgentStatusDot
              status={task.agentStatus}
              verifyAttemptCount={task.verifyAttemptCount ?? 0}
            />
          )}
          {/* Action badge */}
          {task.action && (
            <span>{parseActionLabel(task.agentStatus, task.action)}</span>
          )}
          {task.agentStatus === 'RUNNING' && latestProgress && (
            <span
              className="ml-1 rounded-full bg-info-400/15 px-1 font-mono text-[10px] text-info-400 tabular-nums"
              title={`Step ${latestProgress.step} of ${latestProgress.total}: ${latestProgress.label}`}
            >
              {latestProgress.step}/{latestProgress.total}
            </span>
          )}
        </div>
      )}

      {/* Plan E indicators: chain-link for blocked deps, ↳ for subtasks */}
      {(hasUnresolvedBlockers || task.parentTask) && (
        <div className="flex flex-wrap items-center gap-2 text-body-xs text-text-tertiary">
          {hasUnresolvedBlockers && (
            <span
              className="inline-flex items-center gap-1"
              title={`Blocked by ${unresolvedBlockers.length} unresolved task${unresolvedBlockers.length === 1 ? '' : 's'}`}
            >
              <span>🔗</span>
              <span>{unresolvedBlockers.length}</span>
            </span>
          )}
          {task.parentTask && (
            <span
              className="inline-flex min-w-0 items-center gap-1"
              title={`Subtask of ${task.parentTask.title}`}
            >
              <span>↳</span>
              <span className="truncate">{task.parentTask.title}</span>
            </span>
          )}
        </div>
      )}

      {/* Title */}
      <p className="line-clamp-2 text-body text-text-primary">{task.title}</p>

      <div className="flex flex-col gap-1">
        {/* Target repo */}
        {task.targetRepo && (
          <div className="flex items-center gap-2">
            <a
              className="inline-flex items-center gap-1 rounded-md bg-surface-overlay px-2 py-0.5 font-mono text-body-xs text-text-tertiary"
              href={`https://github.com/${task.targetRepo}`}
              onClick={(e) => e.stopPropagation()}
              rel="noopener"
              target="_blank"
            >
              <GitHubIcon />
              <span>{task.targetRepo}</span>
            </a>
          </div>
        )}

        {/* Footer row */}
        <div className="flex items-center gap-2">
          <div />
          {/* Tags */}
          {task.tags?.length > 0 && (
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {task.tags.slice(0, 3).map((tag) => {
                const bg = `${tag.color}20`
                return (
                  <span
                    className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 font-medium text-body-xs"
                    key={tag.id}
                    style={{ backgroundColor: bg, color: tag.color }}
                  >
                    {tag.name}
                  </span>
                )
              })}
              {task.tags.length > 3 && (
                <span className="shrink-0 text-body-xs text-text-tertiary">
                  +{task.tags.length - 3}
                </span>
              )}
            </div>
          )}

          {!(task.tags?.length > 0) && <div className="flex-1" />}

          {/* Created by */}
          <Avatar name={task.createdBy.username} size="sm" />
        </div>
      </div>
    </m.div>
  )
}
