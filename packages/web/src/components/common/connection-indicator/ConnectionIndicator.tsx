import { useEffect, useState } from 'react'
import { type ConnectionState, connectionStateManager } from '@/graphql'

const STATE_CONFIG: Record<
  ConnectionState,
  { color: string; label: string; pulse: boolean }
> = {
  connected: {
    color: 'bg-success-400',
    label: 'Connected',
    pulse: false,
  },
  error: {
    color: 'bg-error-400',
    label: 'Connection error',
    pulse: false,
  },
  reconnecting: {
    color: 'bg-warning-400',
    label: 'Reconnecting…',
    pulse: true,
  },
}

export function ConnectionIndicator() {
  const [state, setState] = useState<ConnectionState>(
    connectionStateManager.getState(),
  )

  useEffect(() => {
    return connectionStateManager.subscribe(setState)
  }, [])

  const config = STATE_CONFIG[state]

  return (
    <div
      aria-label={`WebSocket: ${config.label}`}
      className="flex items-center gap-1.5"
      role="status"
      title={config.label}
    >
      <span className="relative flex size-2 items-center justify-center">
        {config.pulse && (
          <span
            className={`absolute inline-flex size-full animate-ping rounded-full opacity-75 ${config.color}`}
          />
        )}
        <span
          className={`relative inline-flex size-2 rounded-full ${config.color}`}
        />
      </span>
      <span className="tablet:inline hidden text-body-xs text-text-secondary">
        {config.label}
      </span>
    </div>
  )
}
