import { Badge } from '@/components/common/badge'
import type { AgentStatus, BadgeColor, AgentStatusBadgeProps } from '@/types/components/feature/agent'

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

export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  return (
    <Badge color={agentStatusColor(status)}>
      {status}
    </Badge>
  )
}
