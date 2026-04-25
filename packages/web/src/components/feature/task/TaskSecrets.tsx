import { useForm } from '@tanstack/react-form'
import { useState } from 'react'
import {
  Button,
  FieldError,
  TextAreaInput,
  TextInput,
} from '@/components/common'
import {
  DELETE_TASK_SECRET,
  graphqlClient,
  SET_TASK_REQUIRED_SECRETS,
  SET_TASK_SECRET,
} from '@/graphql'
import { secretUpdateValueSchema, taskSecretRequireSchema } from '@/schemas'
import type {
  RequiredSecretsResponse,
  TaskSecretOverrideFormProps,
  TaskSecretRow,
  TaskSecretRowStatus,
  TaskSecretsProps,
} from '@/types'

export function TaskSecrets({
  task,
  boardSecrets,
  onRequiredChanged,
}: TaskSecretsProps) {
  const required = task.requiredSecrets ?? []
  const missing = new Set(task.missingSecrets ?? [])
  const overrides = new Map((task.taskSecrets ?? []).map((s) => [s.name, s]))
  const boardNames = new Set(boardSecrets.map((s) => s.name))

  const [editingName, setEditingName] = useState<string | null>(null)
  const [addSubmitError, setAddSubmitError] = useState<string | null>(null)

  const addForm = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      setAddSubmitError(null)
      const n = value.name.trim()
      if (required.includes(n)) {
        addForm.reset()
        return
      }
      try {
        const data = await graphqlClient.request<{
          setTaskRequiredSecrets: RequiredSecretsResponse
        }>(SET_TASK_REQUIRED_SECRETS, {
          names: [...required, n],
          taskId: task.id,
        })
        onRequiredChanged?.(data.setTaskRequiredSecrets)
        addForm.reset()
      } catch (err) {
        setAddSubmitError(
          err instanceof Error ? err.message : 'Failed to add requirement.',
        )
      }
    },
    validators: { onSubmit: taskSecretRequireSchema },
  })

  const statusFor = (name: string): TaskSecretRowStatus => {
    if (overrides.has(name)) return 'override'
    if (boardNames.has(name)) return 'board'
    return 'missing'
  }

  const rows: TaskSecretRow[] = required.map((name) => ({
    name,
    status: statusFor(name),
  }))

  const removeRequirement = async (name: string) => {
    try {
      const data = await graphqlClient.request<{
        setTaskRequiredSecrets: RequiredSecretsResponse
      }>(SET_TASK_REQUIRED_SECRETS, {
        names: required.filter((x) => x !== name),
        taskId: task.id,
      })
      onRequiredChanged?.(data.setTaskRequiredSecrets)
    } catch (err) {
      console.error('Failed to remove requirement', err)
    }
  }

  const removeOverride = async (name: string) => {
    try {
      await graphqlClient.request(DELETE_TASK_SECRET, { name, taskId: task.id })
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
            Set a task-level override below, or add the secret in board Settings
            → Secrets.
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-body-sm text-text-tertiary italic">
          No required secrets declared.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              className="rounded-lg border border-border-default bg-surface-inset p-3"
              key={row.name}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 pt-0.5">
                  <code className="font-medium text-body-sm text-text-primary">
                    {row.name}
                  </code>
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
                    onClick={() => setEditingName(row.name)}
                    size="small"
                    type="button"
                    variant="ghost"
                  >
                    {row.status === 'override'
                      ? 'Change override'
                      : 'Set override'}
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
                <OverrideForm
                  name={row.name}
                  onClose={() => setEditingName(null)}
                  taskId={task.id}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-1 flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          addForm.handleSubmit()
        }}
      >
        <addForm.Field name="name">
          {(field) => (
            <div className="flex grow flex-col gap-1">
              <TextInput
                onChange={(v: string) => field.handleChange(v.toUpperCase())}
                placeholder="e.g. OPENAI_API_KEY"
                value={field.state.value}
              />
              <FieldError errors={field.state.meta.errors} />
              {addSubmitError && (
                <span className="text-body-xs text-error-400">
                  {addSubmitError}
                </span>
              )}
            </div>
          )}
        </addForm.Field>
        <datalist id="task-board-secret-names">
          {boardSecrets.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
        <div className="shrink-0">
          <addForm.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button
                color="primary"
                disabled={isSubmitting}
                size="small"
                type="submit"
                variant="ghost"
              >
                Add requirement
              </Button>
            )}
          </addForm.Subscribe>
        </div>
      </form>
    </div>
  )
}

function OverrideForm({ taskId, name, onClose }: TaskSecretOverrideFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { value: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      try {
        await graphqlClient.request(SET_TASK_SECRET, {
          name,
          taskId,
          value: value.value,
        })
        onClose()
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : 'Failed to set task secret.',
        )
      }
    },
    validators: { onSubmit: secretUpdateValueSchema },
  })

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
    >
      <form.Field name="value">
        {(field) => (
          <div className="flex flex-col gap-1">
            {/* CRITICAL: textarea starts empty — write-only, never pre-populate with existing value */}
            <TextAreaInput
              autoFocus
              onChange={field.handleChange}
              placeholder="Override value (write-only)"
              rows={3}
              value={field.state.value}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      {submitError && (
        <span className="text-body-xs text-error-400">{submitError}</span>
      )}
      <div className="flex justify-end gap-2">
        <Button
          color="default"
          onClick={onClose}
          size="small"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button
              color="primary"
              disabled={isSubmitting}
              size="small"
              type="submit"
            >
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  )
}
