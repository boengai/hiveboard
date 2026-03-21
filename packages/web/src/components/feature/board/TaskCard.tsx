import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { m } from 'motion/react'
import { tv } from '@/utils/tailwind-variants'
import { useBoardStore, type Task } from '@/store/boardStore'
import { SpinnerIcon, CheckIcon, XMarkIcon } from '@/components/common/icon'

// Action badge styles
const actionBadge = tv({
  base: 'inline-flex items-center rounded-full px-1.5 py-0.5 text-body-xs font-medium',
  variants: {
    action: {
      plan: 'bg-info-400/15 text-info-400',
      research: 'bg-purple-400/15 text-purple-400',
      implement: 'bg-success-400/15 text-success-400',
      'implement-e2e': 'bg-teal-400/15 text-teal-400',
      revise: 'bg-warning-400/15 text-warning-400',
    } as Record<string, string>,
  },
})

function AgentStatusDot({ status }: { status: Task['agentStatus'] }) {
  if (status === 'IDLE') {
    return <span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-600" />
  }
  if (status === 'QUEUED') {
    return (
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-honey-400" />
    )
  }
  if (status === 'RUNNING') {
    return <span className="inline-flex h-3 w-3 animate-spin text-info-400"><SpinnerIcon size={12} /></span>
  }
  if (status === 'SUCCESS') {
    return <span className="inline-flex text-success-400"><CheckIcon size={12} /></span>
  }
  if (status === 'FAILED') {
    return <span className="inline-flex text-error-400"><XMarkIcon size={12} /></span>
  }
  return null
}

interface TaskCardProps {
  task: Task
}

export function TaskCard({ task }: TaskCardProps) {
  const openDrawerView = useBoardStore((s) => s.openDrawerView)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
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
      whileHover={{ y: -1 }}
      onClick={() => openDrawerView(task.id)}
      className={[
        'cursor-pointer rounded-md border border-border-default bg-surface-raised p-3',
        'hover:border-border-hover hover:shadow-xs',
        'select-none',
        isDragging ? 'opacity-40 shadow-md' : 'opacity-100',
      ].join(' ')}
    >
      {/* Title */}
      <p className="mb-2 line-clamp-2 text-body text-text-primary">{task.title}</p>

      {/* Footer row */}
      <div className="flex items-center gap-2">
        {/* Agent status */}
        <AgentStatusDot status={task.agentStatus} />

        {/* Action badge */}
        {task.action && badgeClass && (
          <span className={badgeClass}>{task.action}</span>
        )}

        <div className="flex-1" />

        {/* Target repo */}
        {task.targetRepo && (
          <span className="max-w-[80px] truncate text-body-xs text-text-tertiary">
            {task.targetRepo}
          </span>
        )}

        {/* Created by */}
        <span className="text-body-xs text-text-tertiary">@{task.createdBy.username}</span>
      </div>
    </m.div>
  )
}
