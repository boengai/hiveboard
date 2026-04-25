import { useForm } from '@tanstack/react-form'
import { useState } from 'react'
import {
  Badge,
  Button,
  Drawer,
  FieldError,
  FieldLabel,
  TextAreaInput,
  TextInput,
} from '@/components'
import {
  ARCHIVE_PLAYBOOK,
  CREATE_PLAYBOOK,
  graphqlClient,
  UNARCHIVE_PLAYBOOK,
  UPDATE_PLAYBOOK,
} from '@/graphql'
import { type PlaybookFormValues, playbookFormSchema } from '@/schemas'
import type { PlaybookEditorProps, PlaybookFormProps } from '@/types'

function parseAllowedTools(raw: string): string[] | null {
  const tools = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  // Empty list -> null. On create this means "use WORKFLOW.md defaults";
  // on edit the resolver interprets null as "clear the override".
  return tools.length > 0 ? tools : null
}

function PlaybookForm({
  mode,
  playbook,
  onCancel,
  onSaved,
}: PlaybookFormProps) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)

  const initialValues: PlaybookFormValues = {
    allowedTools: (playbook?.currentVersion.allowedToolsOverride ?? []).join(
      ', ',
    ),
    defaultsJson: playbook?.currentVersion.defaultsJson ?? '{}',
    description: playbook?.description ?? '',
    displayName: playbook?.displayName ?? '',
    name: playbook?.name ?? '',
    promptTemplate: playbook?.currentVersion.promptTemplate ?? '',
  }

  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async ({ value }) => {
      setServerError(null)
      const allowedToolsOverride = parseAllowedTools(value.allowedTools)
      const defaultsJson = value.defaultsJson || '{}'

      try {
        if (mode === 'create') {
          await graphqlClient.request(CREATE_PLAYBOOK, {
            input: {
              allowedToolsOverride,
              defaultsJson,
              description: value.description,
              displayName: value.displayName,
              name: value.name,
              promptTemplate: value.promptTemplate,
            },
          })
        } else {
          await graphqlClient.request(UPDATE_PLAYBOOK, {
            id: playbook.id,
            input: {
              allowedToolsOverride,
              defaultsJson,
              description: value.description,
              displayName: value.displayName,
              promptTemplate: value.promptTemplate,
            },
          })
        }
        onSaved()
      } catch (e) {
        // Surfaces backend GraphQL errors verbatim:
        // PLAYBOOK_NAME_TAKEN, PLAYBOOK_NOT_FOUND, PLAYBOOK_ARCHIVED,
        // BAD_USER_INPUT.
        setServerError(
          e instanceof Error ? e.message : 'Failed to save playbook',
        )
      }
    },
    validators: { onSubmit: playbookFormSchema },
  })

  const handleArchiveToggle = async () => {
    if (mode !== 'edit') return
    setServerError(null)
    setArchiving(true)
    try {
      await graphqlClient.request(
        playbook.archived ? UNARCHIVE_PLAYBOOK : ARCHIVE_PLAYBOOK,
        { id: playbook.id },
      )
      onSaved()
    } catch (e) {
      // Surfaces PLAYBOOK_NOT_FOUND and any other server error.
      setServerError(
        e instanceof Error ? e.message : 'Failed to change archive state',
      )
      setArchiving(false)
    }
  }

  const saveLabel =
    mode === 'create'
      ? 'Create'
      : `Save as v${playbook.currentVersion.versionNumber + 1}`

  return (
    <form
      className="flex grow flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
    >
      <form.Field name="name">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="pb-name" required={mode === 'create'}>
              Name
            </FieldLabel>
            <TextInput
              disabled={mode === 'edit'}
              id="pb-name"
              onChange={field.handleChange}
              placeholder="lowercase-hyphen"
              value={field.state.value}
            />
            <p className="text-body-xs text-text-tertiary">
              Dispatched as{' '}
              <code>playbook:{field.state.value || '<name>'}</code>. Immutable
              after create.
            </p>
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>

      <form.Field name="displayName">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="pb-display-name">Display name</FieldLabel>
            <TextInput
              id="pb-display-name"
              onChange={field.handleChange}
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="description">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="pb-description">Description</FieldLabel>
            <TextInput
              id="pb-description"
              onChange={field.handleChange}
              value={field.state.value}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="promptTemplate">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="pb-prompt">Prompt template</FieldLabel>
            <TextAreaInput
              id="pb-prompt"
              onChange={field.handleChange}
              rows={10}
              value={field.state.value}
            />
            <p className="text-body-xs text-text-tertiary">
              Mustache — use <code>{'{{task.agent_instruction}}'}</code>, etc.
            </p>
          </div>
        )}
      </form.Field>

      <form.Field name="defaultsJson">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="pb-defaults">
              Defaults (JSON object)
            </FieldLabel>
            <TextAreaInput
              id="pb-defaults"
              onChange={field.handleChange}
              placeholder='{"tags":["tests"]}'
              rows={4}
              value={field.state.value}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>

      <form.Field name="allowedTools">
        {(field) => (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="pb-tools">Allowed tools override</FieldLabel>
            <TextInput
              id="pb-tools"
              onChange={field.handleChange}
              placeholder="Bash, Read, Grep, Glob"
              value={field.state.value}
            />
            <p className="text-body-xs text-text-tertiary">
              Comma-separated. Leave empty to use WORKFLOW.md defaults.
            </p>
          </div>
        )}
      </form.Field>

      {serverError ? (
        <div className="rounded-md border border-error-400/30 bg-error-400/10 p-3 text-body-sm text-error-400">
          {serverError}
        </div>
      ) : null}

      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => {
          const busy = isSubmitting || archiving
          return (
            <div className="mt-auto flex items-center justify-between gap-2 border-border-default border-t pt-5">
              {mode === 'edit' ? (
                <Button
                  color={playbook.archived ? 'primary' : 'danger'}
                  disabled={busy}
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
                  disabled={busy}
                  onClick={onCancel}
                  size="small"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  color="primary"
                  disabled={busy}
                  size="small"
                  type="submit"
                >
                  {isSubmitting ? 'Saving…' : saveLabel}
                </Button>
              </div>
            </div>
          )
        }}
      </form.Subscribe>
    </form>
  )
}

function drawerTitle(state: PlaybookEditorProps['state']): string {
  switch (state.mode) {
    case 'create':
      return 'New playbook'
    case 'edit':
      return `Edit "${state.playbook.name}"`
    default:
      return ''
  }
}

export function PlaybookEditor({
  state,
  onClose,
  onSaved,
}: PlaybookEditorProps) {
  return (
    <Drawer
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={state.mode !== 'closed'}
      size="wide"
      title={
        state.mode === 'edit' ? (
          <span className="flex items-center gap-2">
            <span className="truncate">{drawerTitle(state)}</span>
            {state.playbook.archived ? (
              <Badge color="honey">archived</Badge>
            ) : null}
          </span>
        ) : (
          drawerTitle(state)
        )
      }
    >
      {state.mode === 'create' && (
        <PlaybookForm mode="create" onCancel={onClose} onSaved={onSaved} />
      )}
      {state.mode === 'edit' && (
        <PlaybookForm
          key={state.playbook.id}
          mode="edit"
          onCancel={onClose}
          onSaved={onSaved}
          playbook={state.playbook}
        />
      )}
    </Drawer>
  )
}
