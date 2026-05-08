import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components'
import {
  EXTEND_TIME_BOX,
  graphqlClient,
  KILL_TASK,
  SET_TIME_BOX,
} from '@/graphql'
import type { TaskTimeBoxProps } from '@/types'
import { parseGraphQLError } from '@/utils'

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

const TIME_BOX_ERROR_CODES: Record<string, string> = {
  TIME_BOX_NOT_EXPIRED: 'Time box has not expired yet.',
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
        setError(
          parseGraphQLError(err, {
            codeMap: TIME_BOX_ERROR_CODES,
            defaultMessage: 'Failed to update time box.',
          }),
        )
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
        setError(
          parseGraphQLError(err, {
            codeMap: TIME_BOX_ERROR_CODES,
            defaultMessage: 'Failed to update time box.',
          }),
        )
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
      setError(
        parseGraphQLError(err, {
          codeMap: TIME_BOX_ERROR_CODES,
          defaultMessage: 'Failed to update time box.',
        }),
      )
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
          <Button
            disabled={submitting}
            onClick={() => handleExtend(15 * 60 * 1000)}
            size="small"
            type="button"
            variant="ghost"
          >
            Extend +15m
          </Button>
          <Button
            disabled={submitting}
            onClick={() => handleExtend(30 * 60 * 1000)}
            size="small"
            type="button"
            variant="ghost"
          >
            Extend +30m
          </Button>
          {confirmKill ? (
            <>
              <span className="self-center text-body-xs text-error-400">
                Really kill?
              </span>
              <Button
                color="danger"
                disabled={submitting}
                onClick={handleKill}
                size="small"
                type="button"
              >
                Yes, kill
              </Button>
              <Button
                disabled={submitting}
                onClick={() => setConfirmKill(false)}
                size="small"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              color="danger"
              disabled={submitting}
              onClick={() => setConfirmKill(true)}
              size="small"
              type="button"
              variant="ghost"
            >
              Kill
            </Button>
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
    <div className="flex flex-wrap gap-2">
      {PRESETS.map((p) => {
        const active = timeBoxMs === p.ms
        // Segmented-control-style pill (rounded-full) toggle, not a
        // button-shaped action — legitimate exception per conventions.md §4.
        // If we later add a `chip` variant to Button, swap this for it.
        return (
          <button
            className="rounded-full bg-surface-raised px-2.5 py-1 text-body-xs text-text-tertiary hover:bg-surface-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 data-[active=true]:bg-honey-400/20 data-[active=true]:text-honey-300"
            data-active={active ? 'true' : 'false'}
            disabled={disabled}
            key={p.label}
            onClick={() => applyTimeBox(p.ms)}
            type="button"
          >
            {p.label}
          </button>
        )
      })}
      <div className="ml-1 flex items-center gap-2 border-border-default border-l pl-3">
        {/* Narrow numeric minute field — TextInput has no small/compact size
            variant today. */}
        <span className="text-body-xs text-text-tertiary">Custom</span>
        <input
          aria-label="Custom time box in minutes"
          className="w-16 rounded-md border border-border-default bg-surface-raised px-2 py-1 text-body-xs placeholder:text-text-tertiary"
          disabled={disabled}
          inputMode="numeric"
          onChange={(e) => setCustomMinutes(e.currentTarget.value)}
          placeholder="min"
          type="text"
          value={customMinutes}
        />
        <Button
          disabled={disabled || !customMinutes}
          onClick={handleCustomApply}
          size="small"
          type="button"
          variant="ghost"
        >
          Apply
        </Button>
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
