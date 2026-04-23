import { useState } from 'react'
import { Button, TextAreaInput, TextInput } from '@/components'
import { graphqlClient } from '@/graphql/client'
import {
  ARCHIVE_PLAYBOOK,
  CREATE_PLAYBOOK,
  UNARCHIVE_PLAYBOOK,
  UPDATE_PLAYBOOK,
} from '@/graphql/mutations'
import type { Playbook } from '@/types'

type Props = {
  onClose: () => void
  onSaved: () => void
} & (
  | { mode: 'create'; playbook?: undefined }
  | { mode: 'edit'; playbook: Playbook }
)

const NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/
const RESERVED_PREFIX = 'playbook:'

export function PlaybookEditor({ mode, playbook, onClose, onSaved }: Props) {
  const [name, setName] = useState(playbook?.name ?? '')
  const [displayName, setDisplayName] = useState(playbook?.displayName ?? '')
  const [description, setDescription] = useState(playbook?.description ?? '')
  const [promptTemplate, setPromptTemplate] = useState(
    playbook?.currentVersion.promptTemplate ?? '',
  )
  const [defaultsJson, setDefaultsJson] = useState(
    playbook?.currentVersion.defaultsJson ?? '{}',
  )
  const [allowedTools, setAllowedTools] = useState(
    (playbook?.currentVersion.allowedToolsOverride ?? []).join(', '),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedAllowedTools = (): string[] =>
    allowedTools
      .split(/[,\s]+/)
      .map((s: string) => s.trim())
      .filter(Boolean)

  const handleSave = async () => {
    setError(null)

    // Frontend mirror of backend validation (only relevant on create —
    // edit has the name input disabled so we can't break it).
    if (mode === 'create') {
      if (!NAME_REGEX.test(name)) {
        setError('Name must match /^[a-z0-9]+(-[a-z0-9]+)*$/')
        return
      }
      if (name.startsWith(RESERVED_PREFIX)) {
        setError(`Name must not start with the reserved prefix "${RESERVED_PREFIX}"`)
        return
      }
    }

    try {
      JSON.parse(defaultsJson || '{}')
    } catch (e) {
      setError(`defaultsJson is not valid JSON: ${(e as Error).message}`)
      return
    }

    setSaving(true)
    try {
      const tools = parsedAllowedTools()
      // Semantics:
      //  - create: empty tools -> null (absence -> use WORKFLOW.md defaults)
      //  - edit:   empty tools -> null (resolver interprets null as
      //            "clear the override", same practical effect)
      const allowedToolsOverride = tools.length > 0 ? tools : null

      if (mode === 'create') {
        await graphqlClient.request(CREATE_PLAYBOOK, {
          input: {
            allowedToolsOverride,
            defaultsJson: defaultsJson || '{}',
            description,
            displayName,
            name,
            promptTemplate,
          },
        })
      } else {
        await graphqlClient.request(UPDATE_PLAYBOOK, {
          id: playbook.id,
          input: {
            allowedToolsOverride,
            defaultsJson: defaultsJson || '{}',
            description,
            displayName,
            promptTemplate,
          },
        })
      }
      onSaved()
    } catch (e) {
      // Surfaces backend GraphQL errors verbatim:
      // PLAYBOOK_NAME_TAKEN, PLAYBOOK_NOT_FOUND, PLAYBOOK_ARCHIVED,
      // BAD_USER_INPUT.
      setError(e instanceof Error ? e.message : 'Failed to save playbook')
      setSaving(false)
    }
  }

  const handleArchiveToggle = async () => {
    if (mode !== 'edit') return
    setError(null)
    setSaving(true)
    try {
      await graphqlClient.request(
        playbook.archived ? UNARCHIVE_PLAYBOOK : ARCHIVE_PLAYBOOK,
        { id: playbook.id },
      )
      onSaved()
    } catch (e) {
      // Surfaces PLAYBOOK_NOT_FOUND and any other server error.
      setError(
        e instanceof Error ? e.message : 'Failed to change archive state',
      )
      setSaving(false)
    }
  }

  const saveLabel =
    mode === 'create'
      ? 'Create'
      : `Save as v${playbook.currentVersion.versionNumber + 1}`

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      role="dialog"
    >
      <div className="flex max-h-[90vh] w-[720px] max-w-full flex-col overflow-hidden rounded-lg border border-border-default bg-surface-raised shadow-lg">
        <div className="flex shrink-0 items-center justify-between border-border-default border-b px-5 py-3.5">
          <h2 className="font-semibold text-body-sm text-text-primary">
            {mode === 'create' ? 'New playbook' : `Edit "${playbook.name}"`}
          </h2>
          {mode === 'edit' && playbook.archived ? (
            <span className="text-body-xs text-honey-600">archived</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <label
              className="font-medium text-body-xs text-text-secondary"
              htmlFor="pb-name"
            >
              Name
            </label>
            <TextInput
              disabled={mode === 'edit'}
              id="pb-name"
              onChange={setName}
              placeholder="lowercase-hyphen"
              value={name}
            />
            <p className="text-body-xs text-text-tertiary">
              Dispatched as <code>playbook:{name || '<name>'}</code>. Immutable after create.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="font-medium text-body-xs text-text-secondary"
              htmlFor="pb-display-name"
            >
              Display name
            </label>
            <TextInput
              id="pb-display-name"
              onChange={setDisplayName}
              value={displayName}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="font-medium text-body-xs text-text-secondary"
              htmlFor="pb-description"
            >
              Description
            </label>
            <TextInput
              id="pb-description"
              onChange={setDescription}
              value={description}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="font-medium text-body-xs text-text-secondary"
              htmlFor="pb-prompt"
            >
              Prompt template
            </label>
            <TextAreaInput
              id="pb-prompt"
              onChange={setPromptTemplate}
              rows={10}
              value={promptTemplate}
            />
            <p className="text-body-xs text-text-tertiary">
              Mustache — use <code>{'{{task.agent_instruction}}'}</code>, etc.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="font-medium text-body-xs text-text-secondary"
              htmlFor="pb-defaults"
            >
              Defaults (JSON object)
            </label>
            <TextAreaInput
              id="pb-defaults"
              onChange={setDefaultsJson}
              placeholder='{"tags":["tests"]}'
              rows={4}
              value={defaultsJson}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="font-medium text-body-xs text-text-secondary"
              htmlFor="pb-tools"
            >
              Allowed tools override
            </label>
            <TextInput
              id="pb-tools"
              onChange={setAllowedTools}
              placeholder="Bash, Read, Grep, Glob"
              value={allowedTools}
            />
            <p className="text-body-xs text-text-tertiary">
              Comma-separated. Leave empty to use WORKFLOW.md defaults.
            </p>
          </div>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-body-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-border-default border-t bg-surface-overlay/50 px-5 py-3">
          {mode === 'edit' ? (
            <Button
              color={playbook.archived ? 'primary' : 'danger'}
              disabled={saving}
              onClick={handleArchiveToggle}
              size="small"
              type="button"
              variant="ghost"
            >
              {playbook.archived ? 'Unarchive' : 'Archive'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              disabled={saving}
              onClick={onClose}
              size="small"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              color="primary"
              disabled={saving}
              onClick={handleSave}
              size="small"
              type="button"
            >
              {saveLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
