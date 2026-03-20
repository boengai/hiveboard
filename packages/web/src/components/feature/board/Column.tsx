import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useBoardStore, type Column as ColumnType } from '@/store/boardStore'
import { TaskCard } from './TaskCard'

interface ColumnProps {
  column: ColumnType
  /** The task id where the drop indicator should appear above, or null for end-of-column */
  dropTargetTaskId?: string | null
}

export function Column({ column, dropTargetTaskId }: ColumnProps) {
  const openDrawerCreate = useBoardStore((s) => s.openDrawerCreate)
  const openDrawerView = useBoardStore((s) => s.openDrawerView)
  const showArchived = useBoardStore((s) => s.showArchived)

  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  const activeTasks = column.tasks.filter((t) => !t.archived)
  const archivedTasks = column.tasks.filter((t) => t.archived)

  // In the sortable context, only active (non-archived) tasks are draggable
  const taskIds = activeTasks.map((t) => t.id)

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg border border-border-default bg-surface-inset">
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-body font-medium text-text-primary">{column.name}</span>
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-surface-overlay px-1.5 text-body-xs text-text-tertiary">
            {activeTasks.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => openDrawerCreate(column.id)}
          className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-surface-overlay hover:text-text-secondary"
          aria-label={`Add task to ${column.name}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Task list drop zone */}
      <div
        ref={setNodeRef}
        className={[
          'flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2',
          isOver ? 'rounded-b-lg bg-surface-overlay/40' : '',
        ].join(' ')}
        style={{ minHeight: '4rem' }}
      >
        {dropTargetTaskId === null && (
          <div className="mx-1 mb-1 h-0.5 rounded-full bg-honey-400" />
        )}

        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {activeTasks.length === 0 && !showArchived ? (
            <div className="flex flex-1 items-center justify-center py-6 text-body-sm text-text-tertiary">
              No tasks
            </div>
          ) : (
            activeTasks.map((task) => (
              <div key={task.id}>
                {dropTargetTaskId === task.id && (
                  <div className="mx-1 mb-1 h-0.5 rounded-full bg-honey-400" />
                )}
                <TaskCard task={task} />
              </div>
            ))
          )}
        </SortableContext>

        {/* Archived tasks — shown at bottom when showArchived is ON, not draggable */}
        {showArchived && archivedTasks.length > 0 && (
          <div className="mt-1 flex flex-col gap-2">
            {archivedTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => openDrawerView(task.id)}
                className="w-full cursor-pointer rounded-md border border-border-default bg-surface-raised p-3 text-left opacity-50 hover:opacity-70"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-full bg-gray-800 px-1.5 py-0.5 text-body-xs text-gray-400">
                    Archived
                  </span>
                </div>
                <p className="line-clamp-2 text-body text-text-primary">{task.title}</p>
              </button>
            ))}
          </div>
        )}

        {/* Empty state when show-archived is ON and no tasks at all */}
        {showArchived && activeTasks.length === 0 && archivedTasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-6 text-body-sm text-text-tertiary">
            No tasks
          </div>
        )}
      </div>
    </div>
  )
}
