import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { m } from 'motion/react'
import { Avatar, CheckIcon, SpinnerIcon, XMarkIcon } from '@/components/common'
import { GitHubIcon } from '@/components/common/icon'
import { useBoardStore } from '@/store'
import type { Task, TaskCardProps } from '@/types'
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
    case 'RUNNING':
      switch (action) {
        case 'idle':
          return 'Idle'
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
        case 'idle':
          return 'Idle'
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
      idle: 'bg-gray-400/15 text-gray-400',
      implement: 'bg-success-400/15 text-success-400',
      plan: 'bg-info-400/15 text-info-400',
      revise: 'bg-warning-400/15 text-warning-400',
    } as Record<string, string>,
  },
})

function AgentStatusDot({ status }: { status: Task['agentStatus'] }) {
  if (status === 'IDLE') {
    return (
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-600" />
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

  return (
    <m.div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex cursor-pointer select-none flex-col gap-1 rounded-md border border-border-default bg-surface-raised p-3 opacity-100 hover:border-border-hover hover:shadow-xs data-[dragging=true]:opacity-40 data-[dragging=true]:shadow-md"
      data-dragging={isDragging ? 'true' : 'false'}
      onClick={() => openDrawerView(task.id)}
      whileHover={{ y: -1 }}
    >
      {/* Header row, Agent status + Action badge — hidden in Done column */}
      {badgeClass && column && column.name !== 'Done' && (
        <div className={badgeClass}>
          {/* Agent status — hidden when idle */}
          {task.agentStatus !== 'IDLE' && (
            <AgentStatusDot status={task.agentStatus} />
          )}
          {/* Action badge */}
          {task.action && (
            <span>{parseActionLabel(task.agentStatus, task.action)}</span>
          )}
        </div>
      )}
      {/* Title */}
      <p className="line-clamp-2 text-body text-text-primary">{task.title}</p>

      <div className="flex flex-col gap-1">
        {/* Target repo */}
        {task.targetRepo && (
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-md bg-surface-overlay px-2 py-0.5 font-mono text-body-xs text-text-tertiary">
              <GitHubIcon size={14} />
              <span>{task.targetRepo}</span>
            </div>
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
