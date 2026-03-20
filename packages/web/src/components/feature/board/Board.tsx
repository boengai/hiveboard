import { useEffect, useState } from 'react'
import {
  DndContext,
  closestCorners,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { graphqlClient } from '@/graphql/client'
import { GET_BOARDS } from '@/graphql/queries'
import { MOVE_TASK } from '@/graphql/mutations'
import { subscribe, TASK_UPDATED_SUBSCRIPTION } from '@/graphql/subscriptions'
import { useBoardStore, type Task } from '@/store/boardStore'
import { Column } from './Column'
import { TaskCard } from './TaskCard'

export function Board() {
  const board = useBoardStore((s) => s.board)
  const setBoard = useBoardStore((s) => s.setBoard)
  const showArchived = useBoardStore((s) => s.showArchived)
  const toggleArchived = useBoardStore((s) => s.toggleArchived)
  const moveTaskOptimistic = useBoardStore((s) => s.moveTaskOptimistic)
  const mergeTaskUpdate = useBoardStore((s) => s.mergeTaskUpdate)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  useEffect(() => {
    const fetchBoard = async () => {
      try {
        setLoading(true)
        const data = await graphqlClient.request<{ boards: Parameters<typeof setBoard>[0][] }>(
          GET_BOARDS
        )
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
      }
    )

    return dispose
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id])

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

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    const { active, over } = event
    if (!over || !board) return

    const taskId = String(active.id)
    const overId = String(over.id)

    // Determine target column: either the column itself or find the column of the task being hovered
    let targetColumnId = overId
    let targetColumn = board.columns.find((c) => c.id === overId)

    if (!targetColumn) {
      // overId is a task id — find its column
      for (const col of board.columns) {
        if (col.tasks.some((t) => t.id === overId)) {
          targetColumn = col
          targetColumnId = col.id
          break
        }
      }
    }

    if (!targetColumn) return

    // Don't do anything if dropped on itself and same column
    const sourceColumn = board.columns.find((c) => c.tasks.some((t) => t.id === taskId))
    if (sourceColumn?.id === targetColumnId && taskId === overId) return

    // Calculate position
    const visibleTasks = targetColumn.tasks
      .filter((t) => t.id !== taskId)
      .sort((a, b) => a.position - b.position)

    let position: number

    const lastTask = visibleTasks[visibleTasks.length - 1]

    if (visibleTasks.length === 0) {
      position = 0
    } else if (overId === targetColumnId) {
      // Dropped on column header/empty area — append at end
      position = (lastTask?.position ?? 0) + 1024
    } else {
      // Dropped on a specific task
      const overIndex = visibleTasks.findIndex((t) => t.id === overId)
      if (overIndex === -1) {
        position = (lastTask?.position ?? 0) + 1024
      } else {
        const prev = visibleTasks[overIndex - 1]
        const next = visibleTasks[overIndex]
        if (!prev || !next) {
          position = next ? next.position - 1024 : (lastTask?.position ?? 0) + 1024
        } else {
          position = (prev.position + next.position) / 2
        }
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
            <div key={i} className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border-default bg-surface-inset p-3">
              <div className="h-5 w-24 animate-pulse rounded bg-surface-overlay" />
              {[0, 1, 2].map((j) => (
                <div key={j} className="h-16 animate-pulse rounded-md bg-surface-overlay" />
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

  const sortedColumns = [...board.columns].sort((a, b) => a.position - b.position)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Board sub-header */}
      <div className="flex items-center justify-between border-b border-border-default px-4 py-2">
        <h1 className="text-body font-medium text-text-primary">{board.name}</h1>
        <label className="flex cursor-pointer items-center gap-2 text-body-xs text-text-secondary">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={toggleArchived}
            className="h-3.5 w-3.5 rounded border-border-default bg-surface-base accent-honey-400 focus:outline-none focus:shadow-glow-honey"
          />
          Show Archived
        </label>
      </div>

      {/* Board columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {sortedColumns.map((col) => (
            <Column key={col.id} column={col} />
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
