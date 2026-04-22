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

export type BoardAction = 'PLAN' | 'IMPLEMENT' | 'REVISE'

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
  action: BoardAction | null
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
}
