import { useEffect, useMemo, useState } from 'react'
import { VERIFICATION_RUN_ADDED_SUBSCRIPTION } from '@/graphql'
import { useTaskSubscription } from '@/hooks'
import type {
  TaskVerificationProps,
  VerificationRunAddedPayload,
  VerificationRunGroup,
  VerificationRunView,
} from '@/types'

function durationSecs(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return `${(ms / 1000).toFixed(1)}s`
}

function groupByAgentRun(runs: VerificationRunView[]): VerificationRunGroup[] {
  const map = new Map<string | null, VerificationRunView[]>()
  for (const r of runs) {
    const bucket = map.get(r.agentRunId) ?? []
    bucket.push(r)
    map.set(r.agentRunId, bucket)
  }
  return Array.from(map.entries()).map(([agentRunId, runs]) => ({
    agentRunId,
    runs: [...runs].sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1)),
  }))
}

export function TaskVerification({
  taskId,
  initialRuns,
  verifyAttemptCount,
}: TaskVerificationProps) {
  const [runs, setRuns] = useState<VerificationRunView[]>(initialRuns)

  useEffect(() => {
    setRuns(initialRuns)
  }, [initialRuns])

  useTaskSubscription<VerificationRunAddedPayload>(
    VERIFICATION_RUN_ADDED_SUBSCRIPTION,
    { taskId },
    (data) => {
      const incoming = data.verificationRunAdded
      if (!incoming || incoming.taskId !== taskId) return
      setRuns((prev: VerificationRunView[]) => {
        const next = prev.filter(
          (r: VerificationRunView) => r.id !== incoming.id,
        )
        return [incoming, ...next]
      })
    },
  )

  const groups = useMemo(() => groupByAgentRun(runs), [runs])

  if (runs.length === 0) {
    return (
      <p className="py-2 text-body-xs text-text-tertiary">
        No verification runs yet — run IMPLEMENT to trigger verification.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {verifyAttemptCount > 0 && (
        <div className="rounded border border-warning-400/40 bg-warning-400/10 p-2 text-body-sm text-warning-400">
          Auto-revise attempt {verifyAttemptCount} in progress — verification
          failed on the previous run.
        </div>
      )}
      {groups.map((group: VerificationRunGroup) => {
        const anyFail = group.runs.some(
          (r: VerificationRunView) => r.exitCode !== 0,
        )
        return (
          <details
            className="rounded border border-border-default"
            key={group.agentRunId ?? 'orphan'}
            open={anyFail}
          >
            <summary className="cursor-pointer p-2 text-body-sm">
              Run {group.agentRunId?.slice(-8) ?? '—'} —{' '}
              {anyFail ? (
                <span className="text-error-400">FAIL</span>
              ) : (
                <span className="text-success-400">PASS</span>
              )}{' '}
              ({group.runs.length} command{group.runs.length === 1 ? '' : 's'})
            </summary>
            <div className="flex flex-col gap-2 p-2">
              {group.runs.map((r: VerificationRunView) => (
                <div className="flex flex-col gap-1" key={r.id}>
                  <div className="flex items-center gap-2 text-body-xs">
                    {r.exitCode === 0 ? (
                      <span className="text-success-400">✓</span>
                    ) : (
                      <span className="text-error-400">✗</span>
                    )}
                    <span className="font-medium">{r.label}</span>
                    <code className="text-text-tertiary">{r.command}</code>
                    <span className="text-text-tertiary">
                      exit {r.exitCode} ·{' '}
                      {durationSecs(r.startedAt, r.finishedAt)}
                    </span>
                  </div>
                  {r.exitCode !== 0 && (
                    <pre className="overflow-x-auto rounded bg-surface-overlay/30 p-2 font-mono text-body-xs">
                      {r.output}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}
