import { create } from 'zustand'

export interface Board {
  id: string
  name: string
  columns: Array<Column>
  createdBy: { id: string; username: string; displayName: string }
  createdAt: string
}

export interface Column {
  id: string
  name: string
  position: number
  tasks: Array<Task>
}

export interface Task {
  id: string
  title: string
  body: string
  position: number
  action: string | null
  targetRepo: string | null
  agentStatus: 'IDLE' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED'
  agentOutput: string | null
  agentError: string | null
  retryCount: number
  prUrl: string | null
  prNumber: number | null
  archived: boolean
  archivedAt: string | null
  createdBy: { id: string; username: string; displayName: string }
  updatedBy: { id: string; username: string; displayName: string }
  createdAt: string
  updatedAt: string
  column: { id: string; name: string }
}

interface BoardState {
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
  moveTaskOptimistic: (taskId: string, toColumnId: string, position: number) => void
}

export const useBoardStore = create<BoardState>((set, get) => ({
  board: null,
  selectedTaskId: null,
  showArchived: false,
  drawerMode: 'closed',
  createTaskColumnId: null,

  setBoard: (board) => set({ board }),

  openDrawerCreate: (columnId) =>
    set({
      drawerMode: 'create',
      createTaskColumnId: columnId,
      selectedTaskId: null,
    }),

  openDrawerView: (taskId) =>
    set({
      drawerMode: 'view',
      selectedTaskId: taskId,
      createTaskColumnId: null,
    }),

  closeDrawer: () =>
    set({
      drawerMode: 'closed',
      selectedTaskId: null,
      createTaskColumnId: null,
    }),

  toggleArchived: () => set((s) => ({ showArchived: !s.showArchived })),

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

    // Add to target column at the right position
    const updatedColumns = newColumns.map((col) => {
      if (col.id === toColumnId) {
        const updatedTask = { ...task!, position, column: { id: col.id, name: col.name } }
        const tasks = [...col.tasks, updatedTask].sort((a, b) => a.position - b.position)
        return { ...col, tasks }
      }
      return col
    })

    set({ board: { ...board, columns: updatedColumns } })
  },
}))
