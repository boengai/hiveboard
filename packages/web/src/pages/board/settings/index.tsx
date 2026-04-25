import { useForm } from '@tanstack/react-form'
import { useState } from 'react'
import {
  Button,
  FieldError,
  FieldLabel,
  TextAreaInput,
  TextInput,
} from '@/components'
import { DELETE_BOARD_SECRET, graphqlClient, SET_BOARD_SECRET } from '@/graphql'
import { secretAddFormSchema, secretUpdateValueSchema } from '@/schemas'
import type { SecretsProps, UpdateValueFormProps } from '@/types'

export function Secrets({ boardId, secrets, onRefresh }: SecretsProps) {
  const [addingOpen, setAddingOpen] = useState(false)
  const [addSubmitError, setAddSubmitError] = useState<string | null>(null)
  const [editingName, setEditingName] = useState<string | null>(null)

  const addForm = useForm({
    defaultValues: { description: '', name: '', value: '' },
    onSubmit: async ({ value }) => {
      setAddSubmitError(null)
      try {
        await graphqlClient.request(SET_BOARD_SECRET, {
          boardId,
          description: value.description || null,
          name: value.name,
          value: value.value,
        })
        addForm.reset()
        setAddingOpen(false)
        onRefresh()
      } catch (err) {
        setAddSubmitError(
          err instanceof Error ? err.message : 'Failed to save secret.',
        )
      }
    },
    validators: { onSubmit: secretAddFormSchema },
  })

  const handleDelete = async (secretName: string) => {
    if (
      !confirm(
        `Delete secret "${secretName}"? Tasks that require it will transition to MISSING_SECRETS.`,
      )
    )
      return
    try {
      await graphqlClient.request(DELETE_BOARD_SECRET, {
        boardId,
        name: secretName,
      })
      onRefresh()
    } catch (err) {
      console.error('Failed to delete secret', err)
    }
  }

  return (
    <section>
      <header className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-lg text-text-primary">Secrets</h2>
        <Button
          color="primary"
          onClick={() => {
            setAddingOpen((v) => !v)
            setAddSubmitError(null)
            addForm.reset()
          }}
          size="small"
          type="button"
          variant={addingOpen ? 'ghost' : 'solid'}
        >
          {addingOpen ? 'Cancel' : 'Add secret'}
        </Button>
      </header>

      {addingOpen && (
        <form
          className="mb-6 space-y-3 rounded-lg border border-border-default bg-surface-inset p-4"
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            addForm.handleSubmit()
          }}
        >
          {addSubmitError && (
            <div className="rounded-md bg-error-400/10 px-3 py-2 text-body-sm text-error-400">
              {addSubmitError}
            </div>
          )}
          <addForm.Field name="name">
            {(field) => (
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="board-secret-name" required>
                  Name (UPPER_SNAKE)
                </FieldLabel>
                <TextInput
                  id="board-secret-name"
                  onChange={(v: string) => field.handleChange(v.toUpperCase())}
                  placeholder="DATABASE_URL"
                  value={field.state.value}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </addForm.Field>

          <addForm.Field name="description">
            {(field) => (
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="board-secret-desc">
                  Description (optional)
                </FieldLabel>
                <TextInput
                  id="board-secret-desc"
                  onChange={field.handleChange}
                  placeholder="What this secret is used for"
                  value={field.state.value}
                />
              </div>
            )}
          </addForm.Field>

          <addForm.Field name="value">
            {(field) => (
              <div className="flex flex-col gap-1">
                <FieldLabel required>Value</FieldLabel>
                {/* CRITICAL: starts empty — write-only field, never pre-filled */}
                <TextAreaInput
                  onChange={field.handleChange}
                  placeholder="Secret value"
                  rows={3}
                  value={field.state.value}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </addForm.Field>

          <div className="flex justify-end">
            <addForm.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button
                  color="primary"
                  disabled={isSubmitting}
                  size="small"
                  type="submit"
                >
                  {isSubmitting ? 'Saving…' : 'Save secret'}
                </Button>
              )}
            </addForm.Subscribe>
          </div>
        </form>
      )}

      {secrets.length === 0 ? (
        <p className="text-body-sm text-text-tertiary">No secrets defined.</p>
      ) : (
        <ul className="space-y-2">
          {secrets.map((s) => (
            <li
              className="rounded-lg border border-border-default bg-surface-inset p-3"
              key={s.id}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <code className="font-medium text-body-sm text-text-primary">
                    {s.name}
                  </code>
                  {s.description && (
                    <span className="ml-2 text-body-sm text-text-tertiary">
                      — {s.description}
                    </span>
                  )}
                  <div className="mt-0.5 text-body-xs text-text-tertiary">
                    Updated {new Date(s.updatedAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    color="default"
                    onClick={() => setEditingName(s.name)}
                    size="small"
                    type="button"
                    variant="ghost"
                  >
                    Update value
                  </Button>
                  <Button
                    color="danger"
                    onClick={() => handleDelete(s.name)}
                    size="small"
                    type="button"
                    variant="ghost"
                  >
                    Delete
                  </Button>
                </div>
              </div>

              {editingName === s.name && (
                <UpdateValueForm
                  boardId={boardId}
                  name={s.name}
                  onClose={() => setEditingName(null)}
                  onSaved={onRefresh}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function UpdateValueForm({
  boardId,
  name,
  onClose,
  onSaved,
}: UpdateValueFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { value: '' },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      try {
        await graphqlClient.request(SET_BOARD_SECRET, {
          boardId,
          name,
          value: value.value,
        })
        onSaved()
        onClose()
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : 'Failed to update secret.',
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
              placeholder="New value (leave blank to keep existing)"
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
