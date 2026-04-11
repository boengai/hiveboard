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

export type Task = {
  id: string
  title: string
  body: string
  position: number
  action: BoardAction | null
  agentInstruction: string | null
  targetRepo: string | null
  targetBranch: string | null
  agentStatus: 'IDLE' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED'
  retryCount: number
  prUrl: string | null
  archived: boolean
  archivedAt: string | null
  tags: Tag[]
  createdBy: { id: string; username: string; displayName: string }
  updatedBy: { id: string; username: string; displayName: string }
  createdAt: string
  updatedAt: string
  column?: { id: string; name: string }
}
