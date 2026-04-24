import { useState } from 'react'
import { Button, TextAreaInput, TextInput } from '@/components'
import { DELETE_BOARD_SECRET, SET_BOARD_SECRET } from '@/graphql/mutations'
import { graphqlClient } from '@/graphql'
import type { BoardSecretSummary } from '@/types/models/board'

type Props = { boardId: string; secrets: BoardSecretSummary[]; onRefresh: () => void }

const NAME_RE = /^[A-Z_][A-Z0-9_]*$/

export function Secrets({ boardId, secrets, onRefresh }: Props) {
  const [addingOpen, setAddingOpen] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [value, setValue] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [editingName, setEditingName] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!NAME_RE.test(name)) {
      setFormError('Name must be UPPER_SNAKE (/^[A-Z_][A-Z0-9_]*$/).')
      return
    }
    if (!value) {
      setFormError('Value is required.')
      return
    }
    setSaving(true)
    try {
      await graphqlClient.request(SET_BOARD_SECRET, {
        boardId,
        name,
        value,
        description: desc || null,
      })
      setName('')
      setDesc('')
      setValue('')
      setAddingOpen(false)
      onRefresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save secret.')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateValue(secretName: string) {
    if (!editingValue) return
    setEditSaving(true)
    try {
      await graphqlClient.request(SET_BOARD_SECRET, {
        boardId,
        name: secretName,
        value: editingValue,
      })
      setEditingValue('')
      setEditingName(null)
      onRefresh()
    } catch (err) {
      console.error('Failed to update secret value', err)
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(secretName: string) {
    if (
      !confirm(
        `Delete secret "${secretName}"? Tasks that require it will transition to MISSING_SECRETS.`,
      )
    )
      return
    try {
      await graphqlClient.request(DELETE_BOARD_SECRET, { boardId, name: secretName })
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
          onClick={() => setAddingOpen(!addingOpen)}
          size="small"
          type="button"
          variant={addingOpen ? 'ghost' : 'solid'}
        >
          {addingOpen ? 'Cancel' : 'Add secret'}
        </Button>
      </header>

      {addingOpen && (
        <form className="mb-6 space-y-3 rounded-lg border border-border-default bg-surface-inset p-4" onSubmit={handleAdd}>
          {formError && (
            <div className="rounded-md bg-error-400/10 px-3 py-2 text-body-sm text-error-400">
              {formError}
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-body-sm text-text-secondary">Name (UPPER_SNAKE)</span>
            <TextInput
              onChange={(v: string) => setName(v.toUpperCase())}
              placeholder="DATABASE_URL"
              required
              value={name}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-body-sm text-text-secondary">Description (optional)</span>
            <TextInput
              onChange={setDesc}
              placeholder="What this secret is used for"
              value={desc}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-body-sm text-text-secondary">Value</span>
            {/* CRITICAL: starts empty — write-only field, never pre-filled */}
            <TextAreaInput
              onChange={setValue}
              placeholder="Secret value"
              required
              rows={3}
              value={value}
            />
          </label>
          <div className="flex justify-end">
            <Button color="primary" disabled={saving} size="small" type="submit">
              {saving ? 'Saving…' : 'Save secret'}
            </Button>
          </div>
        </form>
      )}

      {secrets.length === 0 ? (
        <p className="text-body-sm text-text-tertiary">No secrets defined.</p>
      ) : (
        <ul className="space-y-2">
          {secrets.map((s) => (
            <li className="rounded-lg border border-border-default bg-surface-inset p-3" key={s.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <code className="font-medium text-body-sm text-text-primary">{s.name}</code>
                  {s.description && (
                    <span className="ml-2 text-body-sm text-text-tertiary">— {s.description}</span>
                  )}
                  <div className="mt-0.5 text-body-xs text-text-tertiary">
                    Updated {new Date(s.updatedAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    color="default"
                    onClick={() => {
                      setEditingName(s.name)
                      setEditingValue('')
                    }}
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
                <div className="mt-3 space-y-2">
                  {/* CRITICAL: textarea starts empty — write-only, never pre-populate with existing value */}
                  <TextAreaInput
                    autoFocus
                    onChange={setEditingValue}
                    placeholder="New value (leave blank to keep existing)"
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
                      disabled={editSaving || !editingValue}
                      onClick={() => handleUpdateValue(s.name)}
                      size="small"
                      type="button"
                    >
                      {editSaving ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
