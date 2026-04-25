import { useEffect, useState } from 'react'
import { CheckIcon, LoaderIcon, XIcon } from '@/components/common'
import {
  GET_TASK_PROGRESS,
  graphqlClient,
  TASK_PROGRESS_ADDED_SUBSCRIPTION,
} from '@/graphql'
import { useTaskSubscription } from '@/hooks'
import type {
  TaskProgressAddedPayload,
  TaskProgressEntry,
  TaskProgressProps,
} from '@/types'
import { timeAgo } from './TaskEventHistory'

function statusIcon(status: string) {
  if (status === 'DONE')
    return (
      <span className="text-success-400">
        <CheckIcon size={12} />
      </span>
    )
  if (status === 'FAILED')
    return (
      <span className="text-error-400">
        <XIcon size={12} />
      </span>
    )
  return (
    <span className="inline-flex animate-spin text-info-400">
      <LoaderIcon size={12} />
    </span>
  )
}

export function TaskProgress({
  taskId,
  initialEntries,
  agentStatus,
}: TaskProgressProps) {
  const [entries, setEntries] = useState<TaskProgressEntry[]>(initialEntries)

  useEffect(() => {
    setEntries(initialEntries)
  }, [initialEntries])

  // Hydrate from the server on mount — initialEntries is the starting
  // point (usually []), GET_TASK_PROGRESS fills in historical entries.
  useEffect(() => {
    let cancelled = false
    graphqlClient
      .request<{ taskProgress: TaskProgressEntry[] }>(GET_TASK_PROGRESS, {
        taskId,
      })
      .then((res) => {
        if (cancelled) return
        setEntries(res.taskProgress)
      })
      .catch(() => {
        /* leave initialEntries as-is on error */
      })
    return () => {
      cancelled = true
    }
  }, [taskId])

  useTaskSubscription<TaskProgressAddedPayload>(
    TASK_PROGRESS_ADDED_SUBSCRIPTION,
    { taskId },
    (data) => {
      const incoming = data.taskProgressAdded
      if (!incoming || incoming.taskId !== taskId) return
      setEntries((prev: TaskProgressEntry[]) => [...prev, incoming])
    },
  )

  if (entries.length === 0) {
    return (
      <p className="py-2 text-body-xs text-text-tertiary">
        {agentStatus === 'RUNNING'
          ? 'Agent is running but has not emitted progress pings yet.'
          : 'Agent has not emitted progress pings for this run.'}
      </p>
    )
  }

  const latest = entries[entries.length - 1]
  const latestTotal = latest?.total ?? 0
  const latestStep = latest?.step ?? 0

  return (
    <div className="flex flex-col gap-2">
      {latest && (
        <div className="flex items-center justify-between text-body-xs text-text-tertiary">
          <span>
            Step {latestStep} / {latestTotal}
          </span>
          <span>{timeAgo(latest.ts)}</span>
        </div>
      )}
      <ol className="flex flex-col divide-y divide-border-default/50">
        {entries
          .slice()
          .reverse()
          .map((e: TaskProgressEntry) => (
            <li
              className="flex items-center gap-2.5 py-1.5"
              key={`${e.ts}-${e.step}-${e.status}-${e.label}`}
            >
              <span className="w-5 shrink-0 text-center">
                {statusIcon(e.status)}
              </span>
              <span className="shrink-0 font-mono text-body-xs text-text-tertiary tabular-nums">
                {e.step}/{e.total}
              </span>
              <span className="flex-1 text-body-sm text-text-primary">
                {e.label}
                {e.detail && (
                  <span className="ml-2 text-body-xs text-text-tertiary">
                    — {e.detail}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-body-xs text-text-tertiary">
                {timeAgo(e.ts)}
              </span>
            </li>
          ))}
      </ol>
    </div>
  )
}
