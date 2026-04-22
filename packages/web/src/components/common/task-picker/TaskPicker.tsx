import { useState } from 'react'
import type { Task } from '@/types/models'
import { TextInput } from '../input'

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

/**
 * Lightweight board-scoped task picker. Filters by title substring; shows a
 * disabled-reason tooltip for tasks that cannot be picked (e.g. would form a
 * cycle). Caller is responsible for scoping `options` to the right board.
 */
export function TaskPicker({
  options,
  value,
  onChange,
  placeholder = 'Search tasks…',
  excludeIds = [],
}: TaskPickerProps) {
  const [query, setQuery] = useState('')
  const exclusions = new Set(excludeIds)
  const filtered = options
    .filter((o) => !exclusions.has(o.id))
    .filter((o) =>
      query ? o.title.toLowerCase().includes(query.toLowerCase()) : true,
    )
    .slice(0, 50)

  return (
    <div className="flex flex-col gap-2">
      <TextInput onChange={setQuery} placeholder={placeholder} value={query} />
      <div className="max-h-48 overflow-y-auto rounded-md border border-border-default bg-surface-raised">
        {filtered.length === 0 && (
          <div className="p-3 text-body-sm text-text-tertiary italic">
            No matching tasks.
          </div>
        )}
        {filtered.map((o) => (
          <button
            className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-body-sm hover:bg-surface-overlay ${
              value === o.id ? 'bg-surface-overlay' : ''
            } ${o.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            disabled={o.disabled}
            key={o.id}
            onClick={() => onChange(o.id)}
            title={o.disabled ? o.disabledReason : undefined}
            type="button"
          >
            <span className="flex-1 truncate">{o.title}</span>
            <span className="font-mono text-body-xs text-text-tertiary">
              {o.agentStatus}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
