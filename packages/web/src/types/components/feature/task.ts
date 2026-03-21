import type { Task } from '@/store/boardStore'

// ---------------------------------------------------------------------------
// TaskDrawer
// ---------------------------------------------------------------------------

export type ActionColor =
  | 'default'
  | 'info'
  | 'purple'
  | 'success'
  | 'teal'
  | 'warning'
  | 'error'
  | 'honey'

export type FormState = {
  title: string
  body: string
  action: string
  targetRepo: string
}

export type CreateModeProps = {
  form: FormState
  setForm: (f: FormState) => void
  onSubmit: () => Promise<void>
  loading: boolean
}

export type ViewModeProps = {
  task: Task
  onEdit: () => void
  onArchive: () => Promise<void>
  onDelete: () => Promise<void>
  loading: boolean
}

export type AgentPanelProps = {
  task: Task
  onDispatch: (action: string) => Promise<void>
  onCancel: () => Promise<void>
  loading: boolean
  readOnly?: boolean
}

export type EditModeProps = {
  form: FormState
  setForm: (f: FormState) => void
  onSave: () => Promise<void>
  onCancel: () => void
  loading: boolean
}

// ---------------------------------------------------------------------------
// TaskComments
// ---------------------------------------------------------------------------

export type CommentUser = {
  id: string
  username: string
  displayName: string
}

export type Reply = {
  id: string
  body: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  createdBy: CommentUser
}

export type Comment = {
  id: string
  body: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  createdBy: CommentUser
  replies: Reply[]
}

export type CommentBlockProps = {
  taskId: string
  comment: Comment
  onDeleted: (id: string) => void
  onUpdated: (id: string, body: string) => void
  onReplyAdded: (parentId: string, reply: Reply) => void
}

export type TaskCommentsProps = {
  taskId: string
}

// ---------------------------------------------------------------------------
// TaskTimeline
// ---------------------------------------------------------------------------

export type TimelineEntry = {
  id: string
  type: 'event' | 'comment'
  createdAt: string
  // event fields
  eventType?: string
  actor?: { username: string; displayName: string } | null
  isSystem?: boolean
  data?: string | null
  // comment fields
  body?: string
  createdBy?: { username: string; displayName: string }
  parentId?: string | null
  replies?: Array<{
    id: string
    body: string
    createdBy: { username: string; displayName: string }
    createdAt: string
  }>
}

export type RawTimelineEvent = {
  id: string
  type: string
  isSystem: boolean
  data: string | null
  createdAt: string
  actor: { id: string; username: string; displayName: string } | null
}

export type RawComment = {
  id: string
  body: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  createdBy: { id: string; username: string; displayName: string }
  replies: Array<{
    id: string
    body: string
    parentId: string | null
    createdAt: string
    updatedAt: string
    createdBy: { id: string; username: string; displayName: string }
  }>
}

export type TaskTimelineProps = {
  taskId: string
  /** Called when a comment is added/updated so parent can refresh */
  onCommentMutation?: () => void
}
