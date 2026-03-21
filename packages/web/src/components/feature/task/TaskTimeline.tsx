import { type ReactNode, useCallback, useEffect, useState } from 'react'
import {
  ArchiveIcon,
  ArrowRightIcon,
  Badge,
  BoltIcon,
  CheckIcon,
  DotIcon,
  FileTextIcon,
  GitPullRequestIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  XMarkIcon,
} from '@/components/common'
import {
  GET_TASK_TIMELINE,
  graphqlClient,
  subscribe,
  TASK_EVENT_ADDED_SUBSCRIPTION,
} from '@/graphql'
import type {
  RawTimelineEvent,
  TaskTimelineProps,
  TimelineEntry,
} from '@/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(
    dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`,
  ).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(
    dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`,
  ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function parseData(
  raw: string | null | undefined,
): Record<string, string | number> {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function eventIcon(eventType: string): ReactNode {
  const s = 14
  switch (eventType) {
    case 'created':
      return <PlusIcon size={s} />
    case 'moved':
      return <ArrowRightIcon size={s} />
    case 'status_changed':
      return <RefreshIcon size={s} />
    case 'agent_started':
      return <PlayIcon size={s} />
    case 'agent_succeeded':
      return <CheckIcon size={s} />
    case 'agent_failed':
      return <XMarkIcon size={s} />
    case 'pr_opened':
      return <GitPullRequestIcon size={s} />
    case 'archived':
      return <ArchiveIcon size={s} />
    case 'unarchived':
      return <ArchiveIcon size={s} />
    case 'title_changed':
      return <PencilIcon size={s} />
    case 'body_changed':
      return <FileTextIcon size={s} />
    case 'action_set':
      return <BoltIcon size={s} />
    case 'action_cleared':
      return <BoltIcon size={s} />
    case 'comment_added':
      return <MessageIcon size={s} />
    default:
      return <DotIcon size={s} />
  }
}

function eventDescription(
  eventType: string,
  data: string | null | undefined,
): string {
  const d = parseData(data)
  switch (eventType) {
    case 'created':
      return 'created this task'
    case 'moved':
      return `moved this from ${d.from_column ?? d.from ?? '?'} to ${d.to_column ?? d.to ?? '?'}`
    case 'status_changed':
      return `changed status to ${d.to ?? '?'}`
    case 'agent_started': {
      const retry = Number(d.retry ?? 0)
      return `agent started (${d.action ?? '?'}, attempt #${retry + 1})`
    }
    case 'agent_succeeded':
      return `agent succeeded${d.duration ? ` (took ${d.duration})` : ''}`
    case 'agent_failed':
      return `agent failed${d.error ? `: ${d.error}` : ''}`
    case 'pr_opened':
      return `opened PR #${d.pr_number ?? '?'}`
    case 'archived':
      return 'archived this task'
    case 'unarchived':
      return 'unarchived this task'
    case 'title_changed':
      return `changed title from "${d.from ?? '?'}" to "${d.to ?? '?'}"`
    case 'body_changed':
      return 'updated task body'
    case 'action_set':
      return `set action to ${d.action ?? '?'}`
    case 'action_cleared':
      return 'cleared action'
    default:
      return eventType
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EventRow({ entry }: { entry: TimelineEntry }) {
  const icon = eventIcon(entry.eventType ?? '')
  const description = eventDescription(entry.eventType ?? '', entry.data)

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      {/* Icon */}
      <span className="mt-0.5 w-5 shrink-0 text-center text-body-xs text-text-tertiary font-mono">
        {icon}
      </span>

      {/* Actor */}
      {entry.isSystem ? (
        <span className="shrink-0 font-mono">
          <Badge>SYSTEM</Badge>
        </span>
      ) : entry.actor ? (
        <span className="shrink-0 text-body-xs font-medium text-text-primary">
          {entry.actor.username}
        </span>
      ) : null}

      {/* Description */}
      <span className="flex-1 text-body-xs text-text-secondary">
        {description}
      </span>

      {/* Timestamp */}
      <span className="shrink-0 text-body-xs text-text-tertiary">
        {timeAgo(entry.createdAt)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TaskTimeline({ taskId }: TaskTimelineProps) {
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const timelineData = await graphqlClient.request<{
        taskTimeline: RawTimelineEvent[]
      }>(GET_TASK_TIMELINE, { taskId })

      const eventEntries: TimelineEntry[] = timelineData.taskTimeline
        .filter((e) => e.type !== 'comment_added')
        .map((e) => ({
          id: e.id,
          type: 'event' as const,
          createdAt: e.createdAt,
          eventType: e.type,
          actor: e.actor,
          isSystem: e.isSystem,
          data: e.data,
        }))
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        )

      setEntries(eventEntries)
    } catch (err) {
      console.error('TaskTimeline fetch error', err)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Subscribe to new task events
  useEffect(() => {
    const dispose = subscribe<{ taskEventAdded: RawTimelineEvent }>(
      TASK_EVENT_ADDED_SUBSCRIPTION,
      { taskId },
      (data) => {
        const e = data.taskEventAdded
        if (!e || e.type === 'comment_added') return
        const newEntry: TimelineEntry = {
          id: e.id,
          type: 'event',
          createdAt: e.createdAt,
          eventType: e.type,
          actor: e.actor,
          isSystem: e.isSystem,
          data: e.data,
        }
        setEntries((prev) => {
          // Avoid duplicates
          if (prev.some((x) => x.id === newEntry.id)) return prev
          return [...prev, newEntry].sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          )
        })
      },
    )
    return dispose
  }, [taskId])

  if (loading) {
    return (
      <div className="flex flex-col gap-1 pt-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-5 animate-pulse rounded bg-surface-overlay"
            style={{ width: `${60 + i * 10}%` }}
          />
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="py-2 text-body-xs text-text-tertiary">No activity yet.</p>
    )
  }

  return (
    <div className="flex flex-col divide-y divide-border-default/50">
      {entries.map((entry) => (
        <EventRow key={entry.id} entry={entry} />
      ))}
    </div>
  )
}
