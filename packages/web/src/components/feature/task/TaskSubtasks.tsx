import { useBoardStore } from '@/store'
import type { TaskSubtaskSummary, TaskSubtasksProps } from '@/types'

function StatusDot({ status }: { status: TaskSubtaskSummary['agentStatus'] }) {
  const color =
    status === 'SUCCESS'
      ? 'bg-success-400'
      : status === 'FAILED'
        ? 'bg-error-400'
        : status === 'RUNNING'
          ? 'bg-info-400 animate-pulse'
          : status === 'BLOCKED'
            ? 'bg-honey-400'
            : status === 'QUEUED'
              ? 'bg-honey-400 animate-pulse'
              : 'bg-gray-600'
  return (
    <span className={`inline-block size-1.5 shrink-0 rounded-full ${color}`} />
  )
}

function ActionBadge({ action }: { action: TaskSubtaskSummary['action'] }) {
  if (!action) return null
  const tone =
    action === 'IMPLEMENT'
      ? 'bg-success-400/15 text-success-400'
      : action === 'PLAN'
        ? 'bg-info-400/15 text-info-400'
        : 'bg-warning-400/15 text-warning-400'
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide ${tone}`}
    >
      {action.toLowerCase()}
    </span>
  )
}

export function TaskSubtasks({ parentTask, subtasks }: TaskSubtasksProps) {
  const openDrawerView = useBoardStore((s) => s.openDrawerView)

  const completeCount = subtasks.filter(
    (s: TaskSubtaskSummary) => s.agentStatus === 'SUCCESS',
  ).length
  const failedCount = subtasks.filter(
    (s: TaskSubtaskSummary) => s.agentStatus === 'FAILED',
  ).length
  const total = subtasks.length

  return (
    <div className="flex flex-col gap-2">
      {parentTask && (
        <button
          className="flex items-center gap-1.5 self-start rounded-md border border-border-default bg-surface-raised px-2 py-1 text-body-xs text-text-secondary hover:border-border-hover hover:text-text-primary"
          onClick={() => openDrawerView(parentTask.id)}
          type="button"
        >
          <span>↳</span>
          <span>subtask of</span>
          <span className="max-w-[16rem] truncate font-medium">
            {parentTask.title}
          </span>
        </button>
      )}

      {total === 0 && !parentTask && (
        <span className="text-body-xs text-text-tertiary italic">
          No subtasks.
        </span>
      )}

      {total > 0 && (
        <>
          <div className="flex items-center gap-2 text-body-xs text-text-tertiary">
            <span>
              {completeCount} of {total} complete
            </span>
            {failedCount > 0 && (
              <span className="rounded-full bg-error-400/15 px-1.5 py-0.5 font-medium text-error-400">
                {failedCount} failed
              </span>
            )}
          </div>
          <ul className="flex flex-col gap-1">
            {subtasks.map((s: TaskSubtaskSummary) => (
              <li key={s.id}>
                <button
                  className="flex w-full items-center gap-2 rounded-md border border-border-default bg-surface-raised px-2 py-1.5 text-left text-body-sm hover:border-border-hover hover:bg-surface-overlay/40"
                  onClick={() => openDrawerView(s.id)}
                  type="button"
                >
                  <StatusDot status={s.agentStatus} />
                  <span className="flex-1 truncate">{s.title}</span>
                  <ActionBadge action={s.action} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
