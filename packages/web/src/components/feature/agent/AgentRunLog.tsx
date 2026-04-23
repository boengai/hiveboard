import { useEffect, useMemo, useState } from 'react'
import { subscribe } from '@/graphql'
import { CHECKPOINT_ADDED_SUBSCRIPTION } from '@/graphql/subscriptions'

type Checkpoint = {
  id: string
  agentRunId: string
  turn: number
  kind: string
  summary: string
  rawBytes: number
  occurredAt: string
}

type AgentRun = {
  id: string
  action: string | null
  status: string
  turnCount: number
  checkpoints: Checkpoint[]
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

type Props = {
  taskId: string
  agentRuns: AgentRun[]
}

const KIND_ICON: Record<string, string> = {
  assistant: '💬',
  tool_use: '🛠',
  tool_result: '←',
  error: '⚠️',
}

function KindIcon({ kind }: { kind: string }) {
  return (
    <span aria-label={kind} className="inline-block w-5 text-center">
      {KIND_ICON[kind] ?? '•'}
    </span>
  )
}

function CheckpointRow({ cp }: { cp: Checkpoint }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = cp.summary.length > 200
  const displayed =
    expanded || !isLong ? cp.summary : cp.summary.slice(0, 200) + '…'
  return (
    <li className="flex gap-2 font-mono text-body-xs text-text-secondary">
      <span className="w-10 text-right text-text-tertiary">{cp.turn}</span>
      <KindIcon kind={cp.kind} />
      <span className="flex-1 whitespace-pre-wrap break-all">{displayed}</span>
      {isLong && (
        <button
          className="text-text-tertiary underline"
          onClick={() => setExpanded((v: boolean) => !v)}
          type="button"
        >
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </li>
  )
}

export function AgentRunLog({ taskId, agentRuns }: Props) {
  const mostRecent = useMemo(() => {
    if (!agentRuns.length) return null
    const sorted = [...agentRuns].sort((a, b) => b.id.localeCompare(a.id))
    return sorted[0] ?? null
  }, [agentRuns])

  const [liveCheckpoints, setLiveCheckpoints] = useState<Checkpoint[]>(
    mostRecent?.checkpoints ?? [],
  )

  useEffect(() => {
    setLiveCheckpoints(mostRecent?.checkpoints ?? [])
  }, [mostRecent])

  useEffect(() => {
    if (!mostRecent || mostRecent.status !== 'running') return
    const dispose = subscribe<{ checkpointAdded: Checkpoint }>(
      CHECKPOINT_ADDED_SUBSCRIPTION,
      { taskId },
      (data) => {
        if (data.checkpointAdded.agentRunId !== mostRecent.id) return
        setLiveCheckpoints((prev: Checkpoint[]) => {
          if (prev.some((cp: Checkpoint) => cp.id === data.checkpointAdded.id))
            return prev
          return [...prev, data.checkpointAdded].sort(
            (a: Checkpoint, b: Checkpoint) => a.turn - b.turn,
          )
        })
      },
    )
    return dispose
  }, [taskId, mostRecent])

  if (!mostRecent) {
    return (
      <div className="text-body-xs text-text-tertiary">No agent run yet.</div>
    )
  }

  if (liveCheckpoints.length === 0) {
    return (
      <div className="text-body-xs text-text-tertiary">
        No checkpoints recorded for this run.
        {mostRecent.status === 'running'
          ? ' Waiting for the first turn…'
          : mostRecent.status === 'failed'
            ? " (Maybe the run failed before any events streamed, or the CLI doesn't support stream-json on this install.)"
            : ''}
      </div>
    )
  }

  return (
    <ol className="flex flex-col gap-1">
      {liveCheckpoints.map((cp: Checkpoint) => (
        <CheckpointRow cp={cp} key={cp.id} />
      ))}
    </ol>
  )
}
