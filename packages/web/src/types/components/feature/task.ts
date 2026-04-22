import type { TaskFormValues } from '@/schemas/task'
import type {
  Task,
  TaskProgressEntry,
  WorkspaceSnapshotSummary,
} from '@/types/models'
import type { ComboboxOption } from '../common/input'

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

export type CreateModeProps = {
  onSubmit: (values: TaskFormValues) => void
  loading: boolean
  boardTags: Array<{ id: string; name: string; color: string }>
  onCreateTag: (
    name: string,
    updateTagIds: (ids: string[]) => void,
  ) => Promise<void>
  repoOptions: ComboboxOption[]
  branchOptions: ComboboxOption[]
  onImageUpload?: (file: File) => Promise<string>
  uploading?: boolean
}

export type ViewModeProps = {
  task: Task
  onEdit: () => void
  onArchive: () => void
  onInterruptAgent: () => void
  onUpdateAction: (action: string, instruction?: string) => void
  loading: boolean
}

export type AgentPanelProps = {
  task: Task
  onInterruptAgent: () => void
  onUpdateAction: (action: string, instruction?: string) => void
  loading: boolean
}

export type EditModeProps = {
  initialValues: TaskFormValues
  onSubmit: (values: TaskFormValues) => void
  onCancel: () => void
  loading: boolean
  boardTags: Array<{ id: string; name: string; color: string }>
  onCreateTag: (
    name: string,
    updateTagIds: (ids: string[]) => void,
  ) => Promise<void>
  repoOptions: ComboboxOption[]
  branchOptions: ComboboxOption[]
  onImageUpload?: (file: File) => Promise<string>
  uploading?: boolean
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
// TaskEventHistory
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

export type TaskEventHistoryProps = {
  taskId: string
  /** Called when a comment is added/updated so parent can refresh */
  onCommentMutation?: () => void
}

// ---------------------------------------------------------------------------
// TaskScratchpad
// ---------------------------------------------------------------------------

export type TaskScratchpadProps = {
  taskId: string
  initialContent: string
}

export type ScratchpadUpdatedPayload = {
  scratchpadUpdated: {
    taskId: string
    content: string
    updatedAt: string
  }
}

// ---------------------------------------------------------------------------
// TaskMessages
// ---------------------------------------------------------------------------

export type TaskMessageAuthorType = 'HUMAN' | 'AGENT'
export type TaskMessageKind = 'HINT' | 'REDIRECT' | 'QUESTION' | 'ANSWER'

export type TaskMessageUser = {
  id: string
  username: string
  displayName: string
}

export type TaskMessage = {
  id: string
  taskId: string
  authorType: TaskMessageAuthorType
  kind: TaskMessageKind
  body: string
  deliveredAt: string | null
  createdAt: string
  createdBy: TaskMessageUser | null
}

export type TaskMessagesProps = {
  taskId: string
  agentStatus: string // 'IDLE' | 'QUEUED' | 'RUNNING' | 'BLOCKED' | 'SUCCESS' | 'FAILED'
  currentQuestion: { id: string; body: string; createdAt: string } | null
  initialMessages: TaskMessage[]
}

export type MessageAddedPayload = {
  messageAdded: TaskMessage
}

// ---------------------------------------------------------------------------
// TaskProgress (step list) — new in Plan D
// ---------------------------------------------------------------------------

export type TaskProgressProps = {
  taskId: string
  initialEntries: TaskProgressEntry[]
  agentStatus: string
}

export type TaskProgressAddedPayload = {
  taskProgressAdded: TaskProgressEntry
}

// ---------------------------------------------------------------------------
// TaskTimeline (diff scrubber) — new in Plan D
// ---------------------------------------------------------------------------

export type TaskTimelineProps = {
  taskId: string
  initialSnapshots: WorkspaceSnapshotSummary[]
}

export type WorkspaceSnapshotAddedPayload = {
  workspaceSnapshotAdded: WorkspaceSnapshotSummary
}
