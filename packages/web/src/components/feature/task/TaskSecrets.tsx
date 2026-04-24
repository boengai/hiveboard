import { useMemo, useState } from 'react'
import { Button, TextAreaInput, TextInput } from '@/components/common'
import { graphqlClient } from '@/graphql'
import {
  DELETE_TASK_SECRET,
  SET_TASK_REQUIRED_SECRETS,
  SET_TASK_SECRET,
} from '@/graphql/mutations'
import type { BoardSecretSummary, Task } from '@/types/models/board'

type Props = {
  task: Pick<
    Task,
    'id' | 'agentStatus' | 'requiredSecrets' | 'missingSecrets' | 'taskSecrets'
  >
  boardSecrets: BoardSecretSummary[]
  onRequiredChanged?: (next: { requiredSecrets: string[]; missingSecrets: string[]; agentStatus: Task['agentStatus'] }) => void
}

const NAME_RE = /^[A-Z_][A-Z0-9_]*$/

export function TaskSecrets({ task, boardSecrets, onRequiredChanged }: Props) {
  const required = task.requiredSecrets ?? []
  const missing = new Set(task.missingSecrets ?? [])
  const overrides = new Map((task.taskSecrets ?? []).map((s) => [s.name, s]))
  const boardNames = new Set(boardSecrets.map((s) => s.name))

  const [addingName, setAddingName] = useState('')
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function statusFor(name: string): 'override' | 'board' | 'missing' {
    if (overrides.has(name)) return 'override'
    if (boardNames.has(name)) return 'board'
    return 'missing'
  }

  const rows: Array<{ name: string; status: 'override' | 'board' | 'missing' }> = useMemo(
    () => required.map((name) => ({ name, status: statusFor(name) })),
    // statusFor derives from overrides + boardNames, re-compute when those change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [required, boardSecrets, task.taskSecrets],
  )

  async function addRequirement(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const n = addingName.trim()
    if (!NAME_RE.test(n)) {
      setFormError('Name must be UPPER_SNAKE (e.g. API_KEY).')
      return
    }
    if (required.includes(n)) {
      setAddingName('')
      return
    }
    setSaving(true)
    try {
      const data = await graphqlClient.request<{
        setTaskRequiredSecrets: { requiredSecrets: string[]; missingSecrets: string[]; agentStatus: Task['agentStatus'] }
      }>(SET_TASK_REQUIRED_SECRETS, { taskId: task.id, names: [...required, n] })
      onRequiredChanged?.(data.setTaskRequiredSecrets)
      setAddingName('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add requirement.')
    } finally {
      setSaving(false)
    }
  }

  async function removeRequirement(name: string) {
    try {
      const data = await graphqlClient.request<{
        setTaskRequiredSecrets: { requiredSecrets: string[]; missingSecrets: string[]; agentStatus: Task['agentStatus'] }
      }>(SET_TASK_REQUIRED_SECRETS, {
        taskId: task.id,
        names: required.filter((x) => x !== name),
      })
      onRequiredChanged?.(data.setTaskRequiredSecrets)
    } catch (err) {
      console.error('Failed to remove requirement', err)
    }
  }

  async function saveOverride(name: string) {
    if (!editingValue) return
    setSaving(true)
    try {
      await graphqlClient.request(SET_TASK_SECRET, {
        taskId: task.id,
        name,
        value: editingValue,
      })
      setEditingValue('')
      setEditingName(null)
    } catch (err) {
      console.error('Failed to set task secret', err)
    } finally {
      setSaving(false)
    }
  }

  async function removeOverride(name: string) {
    try {
      await graphqlClient.request(DELETE_TASK_SECRET, { taskId: task.id, name })
    } catch (err) {
      console.error('Failed to remove task secret override', err)
    }
  }

  const hasMissing = task.agentStatus === 'MISSING_SECRETS' || missing.size > 0

  return (
    <div className="flex flex-col gap-3">
      {hasMissing && (
        <div className="rounded-md border border-honey-400/40 bg-honey-400/10 p-3 text-body-sm text-honey-300">
          <strong className="font-semibold">Missing secrets: </strong>
          {missing.size > 0 ? [...missing].join(', ') : 'resolving…'}
          <div className="mt-1 text-body-xs text-text-tertiary">
            Set a task-level override below, or add the secret in board Settings → Secrets.
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-body-sm text-text-tertiary italic">No required secrets declared.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              className="rounded-lg border border-border-default bg-surface-inset p-3"
              key={row.name}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 pt-0.5">
                  <code className="font-medium text-body-sm text-text-primary">{row.name}</code>
                  <span
                    className={`ml-2 text-body-xs ${
                      row.status === 'missing'
                        ? 'text-error-400'
                        : 'text-text-tertiary'
                    }`}
                  >
                    {row.status === 'override'
                      ? 'task override'
                      : row.status === 'board'
                      ? 'satisfied by board'
                      : 'missing'}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    color="default"
                    onClick={() => {
                      setEditingName(row.name)
                      setEditingValue('')
                    }}
                    size="small"
                    type="button"
                    variant="ghost"
                  >
                    {row.status === 'override' ? 'Change override' : 'Set override'}
                  </Button>
                  {row.status === 'override' && (
                    <Button
                      color="danger"
                      onClick={() => removeOverride(row.name)}
                      size="small"
                      type="button"
                      variant="ghost"
                    >
                      Remove override
                    </Button>
                  )}
                  <Button
                    color="danger"
                    onClick={() => removeRequirement(row.name)}
                    size="small"
                    type="button"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                </div>
              </div>

              {editingName === row.name && (
                <div className="mt-3 space-y-2">
                  {/* CRITICAL: textarea starts empty — write-only, never pre-populate with existing value */}
                  <TextAreaInput
                    autoFocus
                    onChange={setEditingValue}
                    placeholder="Override value (write-only)"
                    rows={3}
                    value={editingValue}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      color="default"
                      onClick={() => {
                        setEditingName(null)
                        setEditingValue('')
                      }}
                      size="small"
                      type="button"
                      variant="ghost"
                    >
                      Cancel
                    </Button>
                    <Button
                      color="primary"
                      disabled={saving || !editingValue}
                      onClick={() => saveOverride(row.name)}
                      size="small"
                      type="button"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="mt-1 flex items-center gap-2" onSubmit={addRequirement}>
        {formError && (
          <span className="text-body-xs text-error-400">{formError}</span>
        )}
        <TextInput
          onChange={(v: string) => setAddingName(v.toUpperCase())}
          placeholder="ADD_REQUIREMENT_NAME"
          value={addingName}
        />
        <datalist id="task-board-secret-names">
          {boardSecrets.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
        <Button
          color="primary"
          disabled={saving}
          size="small"
          type="submit"
          variant="ghost"
        >
          Add requirement
        </Button>
      </form>
    </div>
  )
}
