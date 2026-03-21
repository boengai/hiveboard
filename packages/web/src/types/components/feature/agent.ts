export type AgentLogChunk = {
  agentLogStream: {
    taskId: string
    chunk: string
    timestamp: string
  }
}

export type AgentLogStreamProps = {
  taskId: string
  agentStatus: string
}

export type AgentStatus =
  | 'IDLE'
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | string

export type BadgeColor =
  | 'default'
  | 'info'
  | 'purple'
  | 'success'
  | 'teal'
  | 'warning'
  | 'error'
  | 'honey'

export type AgentStatusBadgeProps = {
  status: AgentStatus
}
