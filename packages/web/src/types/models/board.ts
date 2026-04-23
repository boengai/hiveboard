export type Board = {
  id: string
  name: string
  columns: Array<Column>
  tags: Tag[]
  createdBy: { id: string; username: string; displayName: string }
  createdAt: string
}

export type Column = {
  id: string
  name: string
  position: number
  tasks: Array<Task>
}

export type Tag = {
  id: string
  name: string
  color: string
}

export type AgentStatus =
  | 'IDLE'
  | 'QUEUED'
  | 'RUNNING'
  | 'BLOCKED'
  | 'SUCCESS'
  | 'FAILED'

export type BlockReason = 'QUESTION' | 'TIMEOUT' | 'DEPENDENCY_FAILED'

export type TaskBlockerSummary = {
  id: string
  title: string
  agentStatus: AgentStatus
  blockReason: BlockReason | null
}

export type TaskSubtaskSummary = {
  id: string
  title: string
  agentStatus: AgentStatus
  blockReason: BlockReason | null
  action: string | null
  createdAt: string
}

export type TaskParentSummary = {
  id: string
  title: string
  agentStatus?: AgentStatus
  tags?: Array<{ color: string }>
}

export type TaskMessageSummary = {
  id: string
  taskId: string
  authorType: 'HUMAN' | 'AGENT'
  kind: 'HINT' | 'REDIRECT' | 'QUESTION' | 'ANSWER'
  body: string
  deliveredAt: string | null
  createdAt: string
  createdBy: { id: string; username: string; displayName: string } | null
}

export type SnapshotFileEntry = {
  path: string
  status: string
  additions: number
  deletions: number
}

export type WorkspaceSnapshotSummary = {
  id: string
  taskId: string
  agentRunId: string | null
  statSummary: string
  fileStatus: SnapshotFileEntry[]
  hasPatch: boolean
  capturedAt: string
}

export type TaskProgressEntry = {
  taskId: string
  agentRunId: string | null
  ts: string
  step: number
  total: number
  label: string
  detail: string | null
  status: 'IN_PROGRESS' | 'DONE' | 'FAILED'
}

export type Task = {
  id: string
  title: string
  body: string
  position: number
  action: string | null
  agentInstruction: string | null
  targetRepo: string | null
  targetBranch: string | null
  agentStatus: 'IDLE' | 'QUEUED' | 'RUNNING' | 'BLOCKED' | 'SUCCESS' | 'FAILED'
  retryCount: number
  prUrl: string | null
  scratchpad: string | null
  archived: boolean
  archivedAt: string | null
  tags: Tag[]
  createdBy: { id: string; username: string; displayName: string }
  updatedBy: { id: string; username: string; displayName: string }
  createdAt: string
  updatedAt: string
  column?: { id: string; name: string }
  messages?: TaskMessageSummary[]
  currentQuestion?: { id: string; body: string; createdAt: string } | null
  verificationRuns?: Array<{
    id: string
    taskId: string
    agentRunId: string | null
    command: string
    label: string
    exitCode: number
    output: string
    startedAt: string
    finishedAt: string
  }>
  verifyAttemptCount?: number
  verifyCommandsOverride?: Array<{
    label: string
    run: string
    timeoutMs: number | null
  }> | null
  workspaceSnapshots?: WorkspaceSnapshotSummary[]
  latestProgress?: TaskProgressEntry | null
  // Plan E — dependencies, subtasks, time-boxing
  blockReason?: BlockReason | null
  timeBoxMs?: number | null
  timeBoxStartedAt?: string | null
  timeBoxRemainingMs?: number | null
  parentTask?: TaskParentSummary | null
  subtasks?: TaskSubtaskSummary[]
  blockers?: TaskBlockerSummary[]
  dependents?: TaskBlockerSummary[]
}
