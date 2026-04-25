import type { Task } from '../../models'

export type TaskPickerOption = {
  id: string
  title: string
  agentStatus: Task['agentStatus']
  disabled?: boolean
  disabledReason?: string
}

export type TaskPickerProps = {
  options: TaskPickerOption[]
  value: string | null
  onChange: (id: string | null) => void
  placeholder?: string
  excludeIds?: string[]
}
