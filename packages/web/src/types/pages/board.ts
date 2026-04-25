import type { BoardSecretSummary } from '../models'

export type SecretsProps = {
  boardId: string
  secrets: BoardSecretSummary[]
  onRefresh: () => void
}

export type UpdateValueFormProps = {
  boardId: string
  name: string
  onClose: () => void
  onSaved: () => void
}
