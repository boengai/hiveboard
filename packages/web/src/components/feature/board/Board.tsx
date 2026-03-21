import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useEffect, useState } from 'react'
import {
  GET_BOARDS,
  graphqlClient,
  MOVE_TASK,
  subscribe,
  TASK_UPDATED_SUBSCRIPTION,
} from '@/graphql'
import { type Task, useBoardStore } from '@/store'
import { Column } from './Column'
import { TaskCard } from './TaskCard'

export function Board() {
  const board = useBoardStore((s) => s.board)
  const setBoard = useBoardStore((s) => s.setBoard)
  const moveTaskOptimistic = useBoardStore((s) => s.moveTaskOptimistic)
  const mergeTaskUpdate = useBoardStore((s) => s.mergeTaskUpdate)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{
    columnId: string
    taskId: string | null
  } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  useEffect(() => {
    const fetchBoard = async () => {
      try {
        setLoading(true)
        const data = await graphqlClient.request<{
          boards: Parameters<typeof setBoard>[0][]
        }>(GET_BOARDS)
        const first = data.boards[0]
        if (first) {
          setBoard(first)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load board')
      } finally {
        setLoading(false)
      }
    }
    fetchBoard()
  }, [setBoard])

  // Subscribe to real-time task updates once we have a board
  useEffect(() => {
    if (!board?.id) return

    const dispose = subscribe<{ taskUpdated: Task }>(
      TASK_UPDATED_SUBSCRIPTION,
      { boardId: board.id },
      (data) => {
        if (data.taskUpdated) {
          mergeTaskUpdate(data.taskUpdated)
        }
      },
    )

    return dispose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id, mergeTaskUpdate])

  function findTaskById(taskId: string): Task | undefined {
    if (!board) return undefined
    for (const col of board.columns) {
      const found = col.tasks.find((t) => t.id === taskId)
      if (found) return found
    }
    return undefined
  }

  function handleDragStart(event: DragStartEvent) {
    const task = findTaskById(String(event.active.id))
    if (task) setActiveTask(task)
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event
    if (!over || !board) {
      setDropIndicator(null)
      return
    }

    const overId = String(over.id)

    // Check if hovering over a column
    const isColumn = board.columns.some((c) => c.id === overId)
    if (isColumn) {
      setDropIndicator({ columnId: overId, taskId: null })
      return
    }

    // Hovering over a task — find its column
    for (const col of board.columns) {
      if (col.tasks.some((t) => t.id === overId)) {
        setDropIndicator({ columnId: col.id, taskId: overId })
        return
      }
    }

    setDropIndicator(null)
  }

  function handleDragEnd(event: DragEndEvent) {
    // Capture the indicator before clearing — it was set by handleDragOver
    // and reflects the actual visual position shown to the user.
    // event.over can differ from what was shown (closestCorners may resolve
    // to the column droppable instead of the specific task).
    const indicator = dropIndicator

    setActiveTask(null)
    setDropIndicator(null)

    const { active } = event
    if (!indicator || !board) return

    const taskId = String(active.id)
    const targetColumnId = indicator.columnId
    const targetColumn = board.columns.find((c) => c.id === targetColumnId)
    if (!targetColumn) return

    // Don't do anything if dropped on itself in the same column with no move
    const sourceColumn = board.columns.find((c) =>
      c.tasks.some((t) => t.id === taskId),
    )
    if (sourceColumn?.id === targetColumnId && indicator.taskId === taskId)
      return

    // Calculate position based on the indicator target
    const visibleTasks = targetColumn.tasks
      .filter((t) => t.id !== taskId && !t.archived)
      .sort((a, b) => a.position - b.position)

    let position: number

    if (visibleTasks.length === 0) {
      position = 0
    } else if (indicator.taskId === null) {
      // Indicator was at top of column (hovering column header)
      const firstTask = visibleTasks[0]
      position = (firstTask?.position ?? 0) - 1024
    } else {
      // Indicator was above a specific task
      const overIndex = visibleTasks.findIndex((t) => t.id === indicator.taskId)
      if (overIndex === -1) {
        // Fallback: append at end
        const lastTask = visibleTasks[visibleTasks.length - 1]
        position = (lastTask?.position ?? 0) + 1024
      } else if (overIndex === 0) {
        // Insert before first task
        position = visibleTasks[0].position - 1024
      } else {
        // Insert between prev and the indicated task
        const prev = visibleTasks[overIndex - 1]
        const next = visibleTasks[overIndex]
        position = (prev.position + next.position) / 2
      }
    }

    // Optimistic update
    moveTaskOptimistic(taskId, targetColumnId, position)

    // Persist to server
    graphqlClient
      .request(MOVE_TASK, { id: taskId, columnId: targetColumnId, position })
      .catch((err) => {
        console.error('moveTask failed', err)
        // TODO: revert optimistic update
      })
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {/* Skeleton header */}
        <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
          <div className="h-5 w-40 animate-pulse rounded bg-surface-overlay" />
          <div className="h-8 w-28 animate-pulse rounded-md bg-surface-overlay" />
        </div>
        {/* Skeleton columns */}
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border-default bg-surface-inset p-3"
            >
              <div className="h-5 w-24 animate-pulse rounded bg-surface-overlay" />
              {[0, 1, 2].map((j) => (
                <div
                  key={j}
                  className="h-16 animate-pulse rounded-md bg-surface-overlay"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-error-400">
        Error: {error}
      </div>
    )
  }

  if (!board) {
    return (
      <div className="flex h-full items-center justify-center text-text-tertiary">
        No boards found.
      </div>
    )
  }

  const sortedColumns = [...board.columns].sort(
    (a, b) => a.position - b.position,
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Board columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {sortedColumns.map((col) => (
            <Column
              key={col.id}
              column={col}
              dropTargetTaskId={
                dropIndicator?.columnId === col.id
                  ? dropIndicator.taskId
                  : undefined
              }
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <div className="w-72 rotate-1 opacity-90">
              <TaskCard task={activeTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
