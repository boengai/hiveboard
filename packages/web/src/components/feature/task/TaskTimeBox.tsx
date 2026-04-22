import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EXTEND_TIME_BOX,
  graphqlClient,
  KILL_TASK,
  SET_TIME_BOX,
} from '@/graphql'
import type { TaskTimeBoxProps } from '@/types'

const PRESETS = [
  { label: 'None', ms: null },
  { label: '15m', ms: 15 * 60 * 1000 },
  { label: '30m', ms: 30 * 60 * 1000 },
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '2h', ms: 120 * 60 * 1000 },
] as const satisfies ReadonlyArray<{ label: string; ms: number | null }>

function formatRemaining(ms: number): string {
  if (ms < 0) ms = 0
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours >= 1) {
    return `${hours}:${String(minutes).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function parseGraphQLError(err: unknown): string {
  const e = err as {
    response?: {
      errors?: Array<{ message: string; extensions?: { code?: string } }>
    }
    message?: string
  }
  const gqlErr = e.response?.errors?.[0]
  if (gqlErr) {
    const code = gqlErr.extensions?.code
    if (code === 'TIME_BOX_NOT_EXPIRED') return 'Time box has not expired yet.'
    if (code === 'BAD_USER_INPUT') return gqlErr.message
    return gqlErr.message
  }
  return e.message ?? 'Failed to update time box.'
}

export function TaskTimeBox({
  taskId,
  agentStatus,
  timeBoxMs,
  timeBoxRemainingMs,
  blockReason,
}: TaskTimeBoxProps) {
  const [error, setError] = useState<string | null>(null)
  const [customMinutes, setCustomMinutes] = useState('')
  const [confirmKill, setConfirmKill] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const isRunning = agentStatus === 'RUNNING'
  const isTimedOut = agentStatus === 'BLOCKED' && blockReason === 'TIMEOUT'

  // --- Countdown tick for RUNNING mode ---
  const [localRemaining, setLocalRemaining] = useState<number | null>(
    timeBoxRemainingMs,
  )
  const lastRemainingRef = useRef<number | null>(timeBoxRemainingMs)

  useEffect(() => {
    setLocalRemaining(timeBoxRemainingMs)
    lastRemainingRef.current = timeBoxRemainingMs
  }, [timeBoxRemainingMs])

  useEffect(() => {
    if (!isRunning || localRemaining === null) return
    const t = setInterval(() => {
      setLocalRemaining((prev: number | null) =>
        prev === null ? null : Math.max(0, prev - 1000),
      )
    }, 1000)
    return () => clearInterval(t)
  }, [isRunning, localRemaining])

  // --- Mutations ---
  const applyTimeBox = useCallback(
    async (ms: number | null) => {
      setError(null)
      setSubmitting(true)
      try {
        await graphqlClient.request(SET_TIME_BOX, {
          taskId,
          timeBoxMs: ms,
        })
      } catch (err) {
        setError(parseGraphQLError(err))
      } finally {
        setSubmitting(false)
      }
    },
    [taskId],
  )

  const handleExtend = useCallback(
    async (additionalMs: number) => {
      setError(null)
      setSubmitting(true)
      try {
        await graphqlClient.request(EXTEND_TIME_BOX, {
          additionalMs,
          taskId,
        })
      } catch (err) {
        setError(parseGraphQLError(err))
      } finally {
        setSubmitting(false)
      }
    },
    [taskId],
  )

  const handleKill = useCallback(async () => {
    setError(null)
    setSubmitting(true)
    try {
      await graphqlClient.request(KILL_TASK, { taskId })
      setConfirmKill(false)
    } catch (err) {
      setError(parseGraphQLError(err))
    } finally {
      setSubmitting(false)
    }
  }, [taskId])

  const handleCustomApply = useCallback(() => {
    const n = Number(customMinutes)
    if (!Number.isFinite(n) || n < 1) {
      setError('Enter a positive number of minutes (or click None).')
      return
    }
    applyTimeBox(n * 60 * 1000)
  }, [customMinutes, applyTimeBox])

  // --- Render ---

  if (isTimedOut) {
    const expiredMinutes = timeBoxMs ? Math.round(timeBoxMs / 60000) : 0
    return (
      <div className="flex flex-col gap-2 rounded-md border border-honey-400/40 bg-honey-400/10 p-3">
        <span className="text-body-sm text-text-primary">
          Time-box expired after {expiredMinutes}m. Agent stopped mid-run.
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md bg-surface-raised px-2 py-1 text-body-xs hover:bg-surface-overlay"
            disabled={submitting}
            onClick={() => handleExtend(15 * 60 * 1000)}
            type="button"
          >
            Extend +15m
          </button>
          <button
            className="rounded-md bg-surface-raised px-2 py-1 text-body-xs hover:bg-surface-overlay"
            disabled={submitting}
            onClick={() => handleExtend(30 * 60 * 1000)}
            type="button"
          >
            Extend +30m
          </button>
          {confirmKill ? (
            <>
              <span className="self-center text-body-xs text-error-400">
                Really kill?
              </span>
              <button
                className="rounded-md bg-error-400/15 px-2 py-1 text-body-xs text-error-400 hover:bg-error-400/25"
                disabled={submitting}
                onClick={handleKill}
                type="button"
              >
                Yes, kill
              </button>
              <button
                className="rounded-md bg-surface-raised px-2 py-1 text-body-xs hover:bg-surface-overlay"
                disabled={submitting}
                onClick={() => setConfirmKill(false)}
                type="button"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="rounded-md bg-surface-raised px-2 py-1 text-body-xs text-error-400 hover:bg-surface-overlay"
              disabled={submitting}
              onClick={() => setConfirmKill(true)}
              type="button"
            >
              Kill
            </button>
          )}
        </div>
        {error && <span className="text-body-xs text-error-400">{error}</span>}
      </div>
    )
  }

  if (isRunning && timeBoxMs) {
    return (
      <div className="flex flex-col gap-1">
        <span className="font-mono text-body-sm text-text-primary tabular-nums">
          {localRemaining !== null
            ? `${formatRemaining(localRemaining)} remaining`
            : 'running'}
        </span>
        <span className="text-body-xs text-text-tertiary">
          Budget: {Math.round(timeBoxMs / 60000)}m
        </span>
        {error && <span className="text-body-xs text-error-400">{error}</span>}
      </div>
    )
  }

  // Editable mode (IDLE / QUEUED / RUNNING-no-budget)
  const disabled = isRunning || submitting
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const active = timeBoxMs === p.ms
          return (
            <button
              className={`rounded-full px-2.5 py-1 text-body-xs ${
                active
                  ? 'bg-honey-400/20 text-honey-300'
                  : 'bg-surface-raised text-text-tertiary hover:bg-surface-overlay hover:text-text-primary'
              } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              disabled={disabled}
              key={p.label}
              onClick={() => applyTimeBox(p.ms)}
              type="button"
            >
              {p.label}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <input
          className="w-20 rounded-md border border-border-default bg-surface-raised px-2 py-1 text-body-xs placeholder:text-text-tertiary"
          disabled={disabled}
          inputMode="numeric"
          onChange={(e) => setCustomMinutes(e.currentTarget.value)}
          placeholder="min"
          type="text"
          value={customMinutes}
        />
        <button
          className="rounded-md bg-surface-raised px-2 py-1 text-body-xs hover:bg-surface-overlay"
          disabled={disabled || !customMinutes}
          onClick={handleCustomApply}
          type="button"
        >
          Apply
        </button>
        {timeBoxMs !== null && !isRunning && (
          <span className="text-body-xs text-text-tertiary">
            Current: {Math.round(timeBoxMs / 60000)}m
          </span>
        )}
      </div>

      {isRunning && !timeBoxMs && (
        <span className="text-body-xs text-text-tertiary italic">
          No time box set for this run.
        </span>
      )}

      {error && <span className="text-body-xs text-error-400">{error}</span>}
    </div>
  )
}
