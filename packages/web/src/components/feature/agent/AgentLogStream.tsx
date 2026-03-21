import { useEffect, useRef, useState } from 'react'
import {
  AGENT_LOG_STREAM_SUBSCRIPTION,
  subscribe,
} from '@/graphql'
import type {
  AgentLogChunk,
  AgentLogStreamProps,
} from '@/types'

export function AgentLogStream({ taskId, agentStatus }: AgentLogStreamProps) {
  const [chunks, setChunks] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isRunning = agentStatus === 'RUNNING'
  const isDone = agentStatus === 'SUCCESS' || agentStatus === 'FAILED'

  // Subscribe when agent is RUNNING
  useEffect(() => {
    if (!isRunning) return

    setStreaming(true)
    const dispose = subscribe<AgentLogChunk>(
      AGENT_LOG_STREAM_SUBSCRIPTION,
      { taskId },
      (data) => {
        const chunk = data.agentLogStream?.chunk
        if (chunk) {
          setChunks((prev) => [...prev, chunk])
        }
      },
    )

    return () => {
      dispose()
      setStreaming(false)
    }
  }, [taskId, isRunning])

  // Auto-scroll to bottom on new chunks
  useEffect(() => {
    const el = scrollRef.current as
      | (HTMLDivElement & { scrollTop: number; scrollHeight: number })
      | null
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  const handleCopyLog = () => {
    navigator.clipboard?.writeText(chunks.join('')).catch(console.error)
  }

  // Only render when running or has output
  if (!isRunning && chunks.length === 0 && !isDone) return null

  const statusLabel = streaming
    ? 'Streaming...'
    : agentStatus === 'SUCCESS'
      ? 'Completed'
      : agentStatus === 'FAILED'
        ? 'Failed'
        : 'Idle'

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-default bg-surface-inset p-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-body-xs font-medium text-text-secondary">
          Agent Output
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`text-body-xs ${
              streaming
                ? 'text-info-400'
                : agentStatus === 'SUCCESS'
                  ? 'text-success-400'
                  : agentStatus === 'FAILED'
                    ? 'text-error-400'
                    : 'text-text-tertiary'
            }`}
          >
            {statusLabel}
          </span>
          {chunks.length > 0 && (
            <button
              type="button"
              onClick={handleCopyLog}
              className="text-body-xs text-text-tertiary hover:text-text-secondary focus:outline-none"
            >
              Copy log
            </button>
          )}
        </div>
      </div>

      {/* Log viewer */}
      <div
        ref={scrollRef}
        className="max-h-64 overflow-y-auto rounded bg-gray-950 p-2"
      >
        {chunks.length === 0 ? (
          <span className="font-mono text-body-xs text-text-tertiary">
            {streaming ? 'Waiting for output...' : 'No output yet.'}
          </span>
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-body-xs text-gray-300">
            {chunks.join('')}
          </pre>
        )}
      </div>
    </div>
  )
}
