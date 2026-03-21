import type { Task } from '@/store/boardStore'

// ---------------------------------------------------------------------------
// TaskDrawer
// ---------------------------------------------------------------------------

export type ActionColor = 'default' | 'info' | 'purple' | 'success' | 'teal' | 'warning' | 'error' | 'honey'

export interface FormState {
  title: string
  body: string
  action: string
  targetRepo: string
}

export interface CreateModeProps {
  form: FormState
  setForm: (f: FormState) => void
  onSubmit: () => Promise<void>
  loading: boolean
}

export interface ViewModeProps {
  task: Task
  onEdit: () => void
  onArchive: () => Promise<void>
  onDelete: () => Promise<void>
  loading: boolean
}

export interface AgentPanelProps {
  task: Task
  onDispatch: (action: string) => Promise<void>
  onCancel: () => Promise<void>
  loading: boolean
  readOnly?: boolean
}

export interface EditModeProps {
  form: FormState
  setForm: (f: FormState) => void
  onSave: () => Promise<void>
  onCancel: () => void
  loading: boolean
}

// ---------------------------------------------------------------------------
// TaskComments
// ---------------------------------------------------------------------------

export interface CommentUser {
  id: string
  username: string
  displayName: string
}

export interface Reply {
  id: string
  body: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  createdBy: CommentUser
}

export interface Comment {
  id: string
  body: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  createdBy: CommentUser
  replies: Reply[]
}

export interface CommentBlockProps {
  taskId: string
  comment: Comment
  onDeleted: (id: string) => void
  onUpdated: (id: string, body: string) => void
  onReplyAdded: (parentId: string, reply: Reply) => void
}

export interface TaskCommentsProps {
  taskId: string
}

// ---------------------------------------------------------------------------
// TaskTimeline
// ---------------------------------------------------------------------------

export interface TimelineEntry {
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

export interface RawTimelineEvent {
  id: string
  type: string
  isSystem: boolean
  data: string | null
  createdAt: string
  actor: { id: string; username: string; displayName: string } | null
}

export interface RawComment {
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

export interface TaskTimelineProps {
  taskId: string
  /** Called when a comment is added/updated so parent can refresh */
  onCommentMutation?: () => void
}
