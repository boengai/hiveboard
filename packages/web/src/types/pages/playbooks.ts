import type { Playbook, PlaybookVersion } from '../models'

export type PlaybookEditorState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; playbook: Playbook }

export type PlaybookEditorProps = {
  state: PlaybookEditorState
  onClose: () => void
  onSaved: () => void
}

export type PlaybookFormProps = {
  onCancel: () => void
  onSaved: () => void
} & (
  | { mode: 'create'; playbook?: undefined }
  | { mode: 'edit'; playbook: Playbook }
)

export type PlaybookListProps = {
  playbooks: Playbook[]
  onEdit?: (pb: Playbook) => void
  onRefresh?: () => void
}

export type PlaybookVersionListProps = {
  versions: PlaybookVersion[]
}
