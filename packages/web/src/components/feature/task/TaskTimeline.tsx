import { useCallback, useEffect, useState } from 'react'
import { graphqlClient } from '@/graphql/client'
import { GET_TASK_TIMELINE, GET_COMMENTS } from '@/graphql/queries'
import { Badge } from '@/components/common/badge'
import { subscribe, TASK_EVENT_ADDED_SUBSCRIPTION } from '@/graphql/subscriptions'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimelineEntry {
  id: string
  type: 'event' | 'comment'
  createdAt: string
  // event fields
  eventType?: string
  actor?: { username: string; displayName: string } | null
  isSystem?: boolean
  data?: string | null
  // comment fields
  body?: string
  createdBy?: { username: string; displayName: string }
  parentId?: string | null
  replies?: Array<{
    id: string
    body: string
    createdBy: { username: string; displayName: string }
    createdAt: string
  }>
}

interface RawTimelineEvent {
  id: string
  type: string
  isSystem: boolean
  data: string | null
  createdAt: string
  actor: { id: string; username: string; displayName: string } | null
}

interface RawComment {
  id: string
  body: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  createdBy: { id: string; username: string; displayName: string }
  replies: Array<{
    id: string
    body: string
    parentId: string | null
    createdAt: string
    updatedAt: string
    createdBy: { id: string; username: string; displayName: string }
  }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function parseData(raw: string | null | undefined): Record<string, string | number> {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function eventIcon(eventType: string): string {
  switch (eventType) {
    case 'created': return '+'
    case 'moved': return '→'
    case 'status_changed': return '↻'
    case 'agent_started': return '▶'
    case 'agent_succeeded': return '✓'
    case 'agent_failed': return '✗'
    case 'pr_opened': return '#'
    case 'archived': return '◻'
    case 'unarchived': return '◻'
    case 'title_changed': return '✎'
    case 'body_changed': return '◻'
    case 'action_set': return '⚡'
    case 'action_cleared': return '⚡'
    default: return '·'
  }
}

function eventDescription(eventType: string, data: string | null | undefined): string {
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
        <Badge className="shrink-0 bg-gray-800 font-mono text-body-xs">SYSTEM</Badge>
      ) : entry.actor ? (
        <span className="shrink-0 text-body-xs font-medium text-text-primary">
          {entry.actor.username}
        </span>
      ) : null}

      {/* Description */}
      <span className="flex-1 text-body-xs text-text-secondary">{description}</span>

      {/* Timestamp */}
      <span className="shrink-0 text-body-xs text-text-tertiary">{timeAgo(entry.createdAt)}</span>
    </div>
  )
}

function CommentRow({
  entry,
  onReply,
}: {
  entry: TimelineEntry
  onReply?: (parentId: string) => void
}) {
  return (
    <div className="flex flex-col gap-1 py-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-body-xs font-medium text-text-primary">
          {entry.createdBy?.username ?? 'unknown'}
        </span>
        <span className="text-body-xs text-text-tertiary">{timeAgo(entry.createdAt)}</span>
      </div>

      {/* Body */}
      <p className="whitespace-pre-wrap text-body-sm text-text-secondary">{entry.body}</p>

      {/* Reply button */}
      {onReply && (
        <button
          type="button"
          className="self-start text-body-xs text-text-tertiary hover:text-text-secondary focus:outline-none focus:shadow-glow-honey"
          onClick={() => onReply(entry.id)}
        >
          Reply
        </button>
      )}

      {/* Threaded replies */}
      {entry.replies && entry.replies.length > 0 && (
        <div className="ml-4 mt-1 flex flex-col gap-2 border-l border-border-default pl-3">
          {entry.replies.map((reply) => (
            <div key={reply.id} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-body-xs font-medium text-text-primary">
                  {reply.createdBy.username}
                </span>
                <span className="text-body-xs text-text-tertiary">{timeAgo(reply.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-body-sm text-text-secondary">{reply.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface TaskTimelineProps {
  taskId: string
  /** Called when a comment is added/updated so parent can refresh */
  onCommentMutation?: () => void
}

export function TaskTimeline({ taskId }: TaskTimelineProps) {
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [replyParentId, setReplyParentId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [timelineData, commentsData] = await Promise.all([
        graphqlClient.request<{ taskTimeline: RawTimelineEvent[] }>(GET_TASK_TIMELINE, { taskId }),
        graphqlClient.request<{ comments: RawComment[] }>(GET_COMMENTS, { taskId }),
      ])

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

      // Only top-level comments in the timeline (parentId === null)
      const commentEntries: TimelineEntry[] = commentsData.comments
        .filter((c) => !c.parentId)
        .map((c) => ({
          id: c.id,
          type: 'comment' as const,
          createdAt: c.createdAt,
          body: c.body,
          createdBy: c.createdBy,
          parentId: c.parentId,
          replies: c.replies.map((r) => ({
            id: r.id,
            body: r.body,
            createdBy: r.createdBy,
            createdAt: r.createdAt,
          })),
        }))

      const merged = [...eventEntries, ...commentEntries].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
      setEntries(merged)
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
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          )
        })
      }
    )
    return dispose
  }, [taskId])

  const handleReply = (parentId: string) => {
    setReplyParentId(replyParentId === parentId ? null : parentId)
  }

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
      {entries.map((entry) =>
        entry.type === 'event' ? (
          <EventRow key={entry.id} entry={entry} />
        ) : (
          <CommentRow
            key={entry.id}
            entry={entry}
            onReply={handleReply}
          />
        )
      )}
      {/* Reply input — shown inline below the relevant comment */}
      {replyParentId && (
        <ReplyInput
          taskId={taskId}
          parentId={replyParentId}
          onDone={() => {
            setReplyParentId(null)
            fetchData()
          }}
          onCancel={() => setReplyParentId(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReplyInput (inline)
// ---------------------------------------------------------------------------

import { ADD_COMMENT } from '@/graphql/mutations'

function ReplyInput({
  taskId,
  parentId,
  onDone,
  onCancel,
}: {
  taskId: string
  parentId: string
  onDone: () => void
  onCancel: () => void
}) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const trimmed = body.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      await graphqlClient.request(ADD_COMMENT, { taskId, body: trimmed, parentId })
      setBody('')
      onDone()
    } catch (err) {
      console.error('ReplyInput submit error', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ml-4 mt-1 flex flex-col gap-1.5 border-l border-border-default pl-3 py-2">
      <textarea
        className="min-h-[60px] resize-y rounded-md border border-border-default bg-surface-base px-3 py-2 text-body-sm text-text-primary outline-none focus:border-honey-400 focus:shadow-glow-honey"
        placeholder="Write a reply…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!body.trim() || submitting}
          onClick={handleSubmit}
          className="rounded-md bg-honey-400 px-3 py-1 text-body-xs font-medium text-gray-900 hover:bg-honey-300 disabled:opacity-50 focus:outline-none focus:shadow-glow-honey"
        >
          {submitting ? 'Replying…' : 'Reply'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1 text-body-xs text-text-secondary hover:text-text-primary focus:outline-none"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
