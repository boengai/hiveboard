import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useBoardStore, type Column as ColumnType } from '@/store/boardStore'
import { TaskCard } from './TaskCard'

interface ColumnProps {
  column: ColumnType
}

export function Column({ column }: ColumnProps) {
  const openDrawerCreate = useBoardStore((s) => s.openDrawerCreate)
  const showArchived = useBoardStore((s) => s.showArchived)

  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  const visibleTasks = showArchived
    ? column.tasks
    : column.tasks.filter((t) => !t.archived)

  const taskIds = visibleTasks.map((t) => t.id)

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg border border-border-default bg-surface-inset">
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-body font-medium text-text-primary">{column.name}</span>
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-surface-overlay px-1.5 text-body-xs text-text-tertiary">
            {visibleTasks.length}
          </span>
        </div>
        <button
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
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {visibleTasks.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-6 text-body-sm text-text-tertiary">
              No tasks
            </div>
          ) : (
            visibleTasks.map((task) => <TaskCard key={task.id} task={task} />)
          )}
        </SortableContext>
      </div>
    </div>
  )
}
