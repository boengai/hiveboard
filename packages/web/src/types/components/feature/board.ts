import type { Column as ColumnType, Task } from '../../models'

export type ColumnProps = {
  column: ColumnType
  /** Task id to show the drop indicator above; null = top of column; undefined = no indicator here */
  dropTargetTaskId?: string | null
  /** True when the indicator should appear at the end of the active-task list */
  dropTargetAtEnd?: boolean
}

export type TaskCardProps = {
  task: Task
  column?: Pick<ColumnType, 'id' | 'name'>
}
