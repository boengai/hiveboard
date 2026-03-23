import { create } from 'zustand'

import type { Board, Task } from '@/types'

type BoardState = {
  board: Board | null
  selectedTaskId: string | null
  showArchived: boolean
  drawerMode: 'closed' | 'create' | 'view'
  createTaskColumnId: string | null

  setBoard: (board: Board) => void
  openDrawerCreate: (columnId: string) => void
  openDrawerView: (taskId: string) => void
  closeDrawer: () => void
  toggleArchived: () => void
  moveTaskOptimistic: (
    taskId: string,
    toColumnId: string,
    position: number,
  ) => void
  mergeTaskUpdate: (updatedTask: Task) => void
}

export const useBoardStore = create<BoardState>((set, get) => ({
  board: null,

  closeDrawer: () =>
    set({
      createTaskColumnId: null,
      drawerMode: 'closed',
      selectedTaskId: null,
    }),
  createTaskColumnId: null,
  drawerMode: 'closed',

  mergeTaskUpdate: (updatedTask) => {
    const board = get().board
    if (!board) return

    const targetColumnId = updatedTask.column?.id
    if (!targetColumnId) return

    // Remove the task from whichever column it currently lives in
    const columnsWithoutTask = board.columns.map((col) => ({
      ...col,
      tasks: col.tasks.filter((t) => t.id !== updatedTask.id),
    }))

    // Insert/update in the correct column
    const updatedColumns = columnsWithoutTask.map((col) => {
      if (col.id === targetColumnId) {
        const tasks = [...col.tasks, updatedTask].sort(
          (a, b) => a.position - b.position,
        )
        return { ...col, tasks }
      }
      return col
    })

    set({ board: { ...board, columns: updatedColumns } })
  },

  moveTaskOptimistic: (taskId, toColumnId, position) => {
    const board = get().board
    if (!board) return

    // Find the task in current columns
    let task: Task | undefined
    const newColumns = board.columns.map((col) => ({
      ...col,
      tasks: col.tasks.filter((t) => {
        if (t.id === taskId) {
          task = t
          return false
        }
        return true
      }),
    }))

    if (!task) return

    // Bind to a const so TypeScript narrows the type inside the closure
    const foundTask = task

    // Add to target column at the right position
    const updatedColumns = newColumns.map((col) => {
      if (col.id === toColumnId) {
        const updatedTask: Task = {
          ...foundTask,
          column: { id: col.id, name: col.name },
          position,
        }
        const tasks = [...col.tasks, updatedTask].sort(
          (a, b) => a.position - b.position,
        )
        return { ...col, tasks }
      }
      return col
    })

    set({ board: { ...board, columns: updatedColumns } })
  },

  openDrawerCreate: (columnId) =>
    set({
      createTaskColumnId: columnId,
      drawerMode: 'create',
      selectedTaskId: null,
    }),

  openDrawerView: (taskId) =>
    set({
      createTaskColumnId: null,
      drawerMode: 'view',
      selectedTaskId: taskId,
    }),
  selectedTaskId: null,

  setBoard: (board) => set({ board }),
  showArchived: false,

  toggleArchived: () => set((s) => ({ showArchived: !s.showArchived })),
}))
