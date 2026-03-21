export interface AgentLogChunk {
  agentLogStream: {
    taskId: string
    chunk: string
    timestamp: string
  }
}

export interface AgentLogStreamProps {
  taskId: string
  agentStatus: string
}

export type AgentStatus = 'IDLE' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | string

export type BadgeColor = 'default' | 'info' | 'purple' | 'success' | 'teal' | 'warning' | 'error' | 'honey'

export interface AgentStatusBadgeProps {
  status: AgentStatus
}
