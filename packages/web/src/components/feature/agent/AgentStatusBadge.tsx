import { Badge } from '@/components/common/badge'

type AgentStatus = 'IDLE' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | string

type BadgeColor = 'default' | 'info' | 'purple' | 'success' | 'teal' | 'warning' | 'error' | 'honey'

function agentStatusColor(status: AgentStatus): BadgeColor {
  switch (status) {
    case 'IDLE': return 'default'
    case 'QUEUED': return 'honey'
    case 'RUNNING': return 'info'
    case 'SUCCESS': return 'success'
    case 'FAILED': return 'error'
    default: return 'default'
  }
}

interface AgentStatusBadgeProps {
  status: AgentStatus
}

export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  return (
    <Badge color={agentStatusColor(status)}>
      {status}
    </Badge>
  )
}
