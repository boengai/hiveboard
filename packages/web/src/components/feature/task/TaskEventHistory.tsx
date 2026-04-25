import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  ArchiveIcon,
  ArrowIcon,
  Avatar,
  Badge,
  Button,
  CheckIcon,
  ChevronIcon,
  DotIcon,
  FileTextIcon,
  GitPullRequestIcon,
  MessageIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  XIcon,
  ZapIcon,
} from '@/components/common'
import {
  GET_TASK_TIMELINE,
  graphqlClient,
  TASK_EVENT_ADDED_SUBSCRIPTION,
} from '@/graphql'
import { useTaskSubscription } from '@/hooks'
import type {
  RawTimelineEvent,
  TaskEventHistoryProps,
  TimelineEntry,
  TimelineGroupedEntry,
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
  ).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
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
      return <ArrowIcon direction="right" size={s} />
    case 'status_changed':
      return <RefreshIcon size={s} />
    case 'agent_started':
      return <PlayIcon size={s} />
    case 'agent_succeeded':
      return <CheckIcon size={s} />
    case 'agent_failed':
      return <XIcon size={s} />
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
      return <ZapIcon size={s} />
    case 'action_cleared':
      return <ZapIcon size={s} />
    case 'tags_changed':
      return <PencilIcon size={s} />
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
      return `opened PR #${String(d.pr_url ?? '').match(/\/pull\/(\d+)/)?.[1] ?? '?'}`
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
    case 'tags_changed':
      return 'updated tags'
    default:
      return eventType
  }
}

/**
 * Pill rendered for actions that reference a playbook (value like
 * `playbook:<name>`). Surfaces playbook-driven runs visually in the timeline.
 */
function PlaybookChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-honey-600/15 px-1.5 py-px font-medium text-[11px] text-honey-600">
      <span aria-hidden>▶</span>
      <code className="font-mono">{name}</code>
    </span>
  )
}

/**
 * Like `eventDescription` but returns a ReactNode so playbook actions can
 * render as a chip instead of the raw `playbook:<name>` string.
 */
function renderEventDescription(
  eventType: string,
  data: string | null | undefined,
): ReactNode {
  const d = parseData(data)
  const action = typeof d.action === 'string' ? d.action : null
  if (eventType === 'agent_started' && action?.startsWith('playbook:')) {
    const retry = Number(d.retry ?? 0)
    return (
      <>
        agent started (
        <PlaybookChip name={action.slice('playbook:'.length)} />, attempt #
        {retry + 1})
      </>
    )
  }
  if (eventType === 'action_set' && action?.startsWith('playbook:')) {
    return (
      <>
        set action to <PlaybookChip name={action.slice('playbook:'.length)} />
      </>
    )
  }
  return eventDescription(eventType, data)
}

/** Key used to determine if consecutive events are "the same" and can be grouped. */
function eventGroupKey(entry: TimelineEntry): string {
  const desc = eventDescription(entry.eventType ?? '', entry.data)
  const actorId = entry.isSystem
    ? '__SYSTEM__'
    : (entry.actor?.username ?? '__NONE__')
  return `${actorId}::${desc}`
}

// ---------------------------------------------------------------------------
// Grouping logic — merge consecutive identical events into clusters
// ---------------------------------------------------------------------------

function groupConsecutiveEvents(
  entries: TimelineEntry[],
): TimelineGroupedEntry[] {
  if (entries.length === 0) return []

  const first = entries[0] as TimelineEntry
  const groups: TimelineGroupedEntry[] = []
  let run: TimelineEntry[] = [first]
  let runKey = eventGroupKey(first)

  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i] as TimelineEntry
    const key = eventGroupKey(entry)
    if (key === runKey) {
      run.push(entry)
    } else {
      flush(run, groups)
      run = [entry]
      runKey = key
    }
  }
  flush(run, groups)
  return groups
}

function flush(run: TimelineEntry[], groups: TimelineGroupedEntry[]) {
  const head = run[0] as TimelineEntry
  if (run.length === 1) {
    groups.push({ entry: head, kind: 'single' })
  } else {
    groups.push({
      description: eventDescription(head.eventType ?? '', head.data),
      entries: run,
      eventType: head.eventType ?? '',
      kind: 'cluster',
    })
  }
}

/** How many recent groups to show before collapsing older ones. */
const VISIBLE_TAIL = 6

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EventRow({ entry }: { entry: TimelineEntry }) {
  const icon = eventIcon(entry.eventType ?? '')
  const description = renderEventDescription(entry.eventType ?? '', entry.data)

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      {/* Icon */}
      <span className="w-5 shrink-0 text-center font-mono text-body-xs text-text-tertiary">
        {icon}
      </span>

      {/* Actor */}
      {entry.isSystem ? (
        <span className="shrink-0 font-mono">
          <Badge>SYSTEM</Badge>
        </span>
      ) : entry.actor ? (
        <Avatar name={entry.actor.username} size="sm" />
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

function ClusterRow({
  group,
}: {
  group: TimelineGroupedEntry & { kind: 'cluster' }
}) {
  const [expanded, setExpanded] = useState(false)
  const { entries, eventType } = group
  const first = entries[0] as TimelineEntry
  const last = entries[entries.length - 1] as TimelineEntry
  const icon = eventIcon(eventType)
  const description = renderEventDescription(first.eventType ?? '', first.data)

  return (
    <div>
      {/* Summary row — full-width interactive row containing Badge/Avatar; not Button-shaped */}
      <button
        className="flex w-full items-center gap-2.5 py-1.5 text-left transition-colors hover:bg-surface-overlay/40"
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        <span className="w-5 shrink-0 text-center font-mono text-body-xs text-text-tertiary">
          {icon}
        </span>

        {first.isSystem ? (
          <span className="shrink-0 font-mono">
            <Badge>SYSTEM</Badge>
          </span>
        ) : first.actor ? (
          <Avatar name={first.actor.username} size="sm" />
        ) : null}

        <span className="flex-1 text-body-xs text-text-secondary">
          {description}
          <span className="ml-1.5 inline-flex items-center rounded-full bg-surface-overlay px-1.5 py-px font-medium text-[10px] text-text-tertiary tabular-nums">
            {entries.length}x
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5 text-body-xs text-text-tertiary">
          {timeAgo(last.createdAt)}
          <span
            className="transition-transform duration-150"
            style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
          >
            <ChevronIcon size={10} />
          </span>
        </span>
      </button>

      {/* Expanded individual rows */}
      {expanded && (
        <div className="ml-5 border-border-default/40 border-l pl-2.5">
          {entries.map((entry) => (
            <div className="flex items-center gap-2.5 py-1" key={entry.id}>
              {entry.isSystem ? (
                <span className="shrink-0 font-mono">
                  <Badge>SYSTEM</Badge>
                </span>
              ) : entry.actor ? (
                <Avatar name={entry.actor.username} size="sm" />
              ) : null}
              <span className="flex-1 text-body-xs text-text-tertiary">
                {renderEventDescription(entry.eventType ?? '', entry.data)}
              </span>
              <span className="shrink-0 text-body-xs text-text-tertiary">
                {timeAgo(entry.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GroupRow({ group }: { group: TimelineGroupedEntry }) {
  if (group.kind === 'single') return <EventRow entry={group.entry} />
  return <ClusterRow group={group} />
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function rawToTimelineEntries(raw: RawTimelineEvent[]): TimelineEntry[] {
  return raw
    .filter((e) => e.type !== 'comment_added')
    .map((e) => ({
      actor: e.actor,
      createdAt: e.createdAt,
      data: e.data,
      eventType: e.type,
      id: e.id,
      isSystem: e.isSystem,
      type: 'event' as const,
    }))
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
}

export function TaskEventHistory({
  taskId,
  initialEntries,
}: TaskEventHistoryProps) {
  // Parent passes `undefined` only when it isn't orchestrating the timeline
  // fetch itself. When it passes an array (even empty), we trust it and skip
  // the self-fetch; parent-driven updates flow in via the sync effect below.
  const hasInitial = initialEntries !== undefined
  const [entries, setEntries] = useState<TimelineEntry[]>(
    hasInitial ? rawToTimelineEntries(initialEntries) : [],
  )
  const [loading, setLoading] = useState(!hasInitial)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const timelineData = await graphqlClient.request<{
        taskTimeline: RawTimelineEvent[]
      }>(GET_TASK_TIMELINE, { taskId })
      setEntries(rawToTimelineEntries(timelineData.taskTimeline))
    } catch (err) {
      console.error('TaskEventHistory fetch error', err)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    if (hasInitial) return
    fetchData()
  }, [fetchData, hasInitial])

  // Sync when the parent's parallel fetch resolves later. The subscription
  // effect (below) handles live pushes; this one handles the initial load.
  // Replace (not merge): parent's snapshot supersedes any prior local state.
  // Safe today because the parent fetches exactly once per drawer-open.
  // Skip empty arrays — the parent sends a transient `[]` while its fetch
  // is pending and we don't want to clobber subscription events that may
  // have arrived in that window.
  useEffect(() => {
    if (!initialEntries || initialEntries.length === 0) return
    setEntries(rawToTimelineEntries(initialEntries))
  }, [initialEntries])

  const [showAll, setShowAll] = useState(false)

  // Subscribe to new task events
  useTaskSubscription<{ taskEventAdded: RawTimelineEvent }>(
    TASK_EVENT_ADDED_SUBSCRIPTION,
    { taskId },
    (data) => {
      const e = data.taskEventAdded
      if (!e || e.type === 'comment_added') return
      const newEntry: TimelineEntry = {
        actor: e.actor,
        createdAt: e.createdAt,
        data: e.data,
        eventType: e.type,
        id: e.id,
        isSystem: e.isSystem,
        type: 'event',
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

  // Group consecutive identical events
  const grouped = useMemo(() => groupConsecutiveEvents(entries), [entries])

  // Split into collapsed / visible
  const needsCollapse = !showAll && grouped.length > VISIBLE_TAIL
  const hiddenCount = needsCollapse ? grouped.length - VISIBLE_TAIL : 0
  const visibleGroups = needsCollapse ? grouped.slice(-VISIBLE_TAIL) : grouped

  if (loading) {
    return (
      <div className="flex flex-col gap-1 pt-2">
        {[0, 1, 2].map((i) => (
          <div
            className="h-5 animate-pulse rounded bg-surface-overlay"
            key={i}
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
      {/* "Show earlier / Show less" toggle */}
      {grouped.length > VISIBLE_TAIL && (
        <Button
          block
          color="primary"
          onClick={() => setShowAll((v) => !v)}
          size="small"
          type="button"
          variant="link-muted"
        >
          <span
            className="mr-1.5 transition-transform duration-150"
            style={{ transform: showAll ? 'rotate(180deg)' : undefined }}
          >
            <ChevronIcon size={10} />
          </span>
          <span>
            {showAll
              ? 'Show less'
              : `Show ${hiddenCount} earlier ${hiddenCount === 1 ? 'event' : 'events'}`}
          </span>
        </Button>
      )}

      {/* Visible rows */}
      {visibleGroups.map((group) => (
        <GroupRow
          group={group}
          key={group.kind === 'single' ? group.entry.id : group.entries[0]?.id}
        />
      ))}
    </div>
  )
}
