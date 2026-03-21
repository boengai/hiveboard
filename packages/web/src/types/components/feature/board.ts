import type { Column as ColumnType, Task } from '@/store'

export type ColumnProps = {
  column: ColumnType
  /** The task id where the drop indicator should appear above, or null for end-of-column */
  dropTargetTaskId?: string | null
}

export type TaskCardProps = {
  task: Task
}
