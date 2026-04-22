import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GET_WORKSPACE_SNAPSHOT_PATCH,
  graphqlClient,
  subscribe,
  WORKSPACE_SNAPSHOT_ADDED_SUBSCRIPTION,
} from '@/graphql'
import type {
  SnapshotFileEntry,
  TaskTimelineProps,
  WorkspaceSnapshotAddedPayload,
  WorkspaceSnapshotSummary,
} from '@/types'
import { timeAgo } from './TaskEventHistory'

function formatFileStatus(s: string): string {
  if (s.startsWith('R')) return 'renamed'
  if (s.startsWith('C')) return 'copied'
  if (s === 'A') return 'added'
  if (s === 'M') return 'modified'
  if (s === 'D') return 'deleted'
  return s
}

export function TaskTimeline({ taskId, initialSnapshots }: TaskTimelineProps) {
  const [snapshots, setSnapshots] =
    useState<WorkspaceSnapshotSummary[]>(initialSnapshots)
  const [index, setIndex] = useState<number>(
    Math.max(0, initialSnapshots.length - 1),
  )
  const [liveFollow, setLiveFollow] = useState<boolean>(true)
  const [patch, setPatch] = useState<string | null>(null)
  const [patchLoading, setPatchLoading] = useState<boolean>(false)
  const patchCache = useRef<Map<string, string>>(new Map())

  // Sync on initialSnapshots change (new open of the drawer)
  useEffect(() => {
    setSnapshots(initialSnapshots)
    if (liveFollow) {
      setIndex(Math.max(0, initialSnapshots.length - 1))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSnapshots])

  // Live subscription
  useEffect(() => {
    const dispose = subscribe<WorkspaceSnapshotAddedPayload>(
      WORKSPACE_SNAPSHOT_ADDED_SUBSCRIPTION,
      { taskId },
      (data) => {
        const s = data.workspaceSnapshotAdded
        if (!s || s.taskId !== taskId) return
        setSnapshots((prev: WorkspaceSnapshotSummary[]) => {
          if (prev.some((x: WorkspaceSnapshotSummary) => x.id === s.id))
            return prev
          const next = [...prev, s].sort(
            (a: WorkspaceSnapshotSummary, b: WorkspaceSnapshotSummary) =>
              a.capturedAt < b.capturedAt ? -1 : 1,
          )
          if (liveFollow) setIndex(next.length - 1)
          return next
        })
      },
    )
    return dispose
  }, [taskId, liveFollow])

  const current: WorkspaceSnapshotSummary | undefined = snapshots[index]

  // Fetch patch when the current snapshot changes.
  useEffect(() => {
    if (!current) {
      setPatch(null)
      return
    }
    if (!current.hasPatch) {
      setPatch(null)
      return
    }
    const cached = patchCache.current.get(current.id)
    if (cached !== undefined) {
      setPatch(cached)
      return
    }
    let cancelled = false
    setPatchLoading(true)
    graphqlClient
      .request<{ workspaceSnapshotPatch: string }>(
        GET_WORKSPACE_SNAPSHOT_PATCH,
        { id: current.id },
      )
      .then((res) => {
        if (cancelled) return
        patchCache.current.set(current.id, res.workspaceSnapshotPatch ?? '')
        setPatch(res.workspaceSnapshotPatch ?? '')
      })
      .catch(() => {
        if (cancelled) return
        setPatch(null)
      })
      .finally(() => {
        if (!cancelled) setPatchLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [current?.id, current?.hasPatch])

  const changedFiles: SnapshotFileEntry[] = useMemo(
    () => current?.fileStatus ?? [],
    [current],
  )

  if (snapshots.length === 0) {
    return (
      <p className="py-2 text-body-xs text-text-tertiary">
        No workspace snapshots yet — snapshots are captured every 15 s while the
        agent is running.
      </p>
    )
  }

  const atLatest = index === snapshots.length - 1

  return (
    <div className="flex flex-col gap-3">
      {/* Slider row */}
      <div className="flex items-center gap-3">
        <input
          aria-label="Snapshot timeline"
          className="flex-1"
          max={snapshots.length - 1}
          min={0}
          onChange={(e) => {
            const next = Number(e.target.value)
            setIndex(next)
            setLiveFollow(next === snapshots.length - 1)
          }}
          step={1}
          type="range"
          value={index}
        />
        <span className="shrink-0 font-mono text-body-xs text-text-tertiary tabular-nums">
          {index + 1} / {snapshots.length}
        </span>
        {!atLatest && (
          <button
            className="shrink-0 rounded border border-border-default px-2 py-0.5 text-body-xs text-text-secondary hover:bg-surface-overlay"
            onClick={() => {
              setIndex(snapshots.length - 1)
              setLiveFollow(true)
            }}
            type="button"
          >
            Jump to latest
          </button>
        )}
      </div>

      {/* Metadata row */}
      {current && (
        <div className="flex items-center gap-3 text-body-xs text-text-tertiary">
          <span>{timeAgo(current.capturedAt)}</span>
          <span className="truncate font-mono">
            {current.statSummary.split('\n')[0]}
          </span>
        </div>
      )}

      {/* File list */}
      {changedFiles.length > 0 && (
        <ul className="flex flex-col gap-1">
          {changedFiles.map((f: SnapshotFileEntry) => (
            <li className="flex items-center gap-2 text-body-xs" key={f.path}>
              <span className="inline-flex h-4 w-10 shrink-0 items-center justify-center rounded bg-surface-overlay font-mono text-[10px] text-text-tertiary uppercase">
                {formatFileStatus(f.status)}
              </span>
              <span className="flex-1 truncate font-mono">{f.path}</span>
              <span className="shrink-0 text-success-400 tabular-nums">
                +{f.additions}
              </span>
              <span className="shrink-0 text-error-400 tabular-nums">
                -{f.deletions}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Patch viewer */}
      {current && !current.hasPatch && (
        <p className="py-2 text-body-xs text-text-tertiary">
          Patch unavailable for this snapshot (diff exceeded the per-task disk
          budget; only file stats were captured).
        </p>
      )}
      {current && current.hasPatch && (
        <details className="rounded border border-border-default">
          <summary className="cursor-pointer p-2 text-body-sm">
            Show diff
          </summary>
          <pre className="max-h-96 overflow-auto rounded-b bg-surface-overlay/30 p-2 font-mono text-body-xs leading-relaxed">
            {patchLoading ? 'Loading diff…' : (patch ?? '')}
          </pre>
        </details>
      )}
    </div>
  )
}
