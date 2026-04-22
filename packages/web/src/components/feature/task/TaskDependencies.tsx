import { useCallback, useEffect, useMemo, useState } from 'react'
import { TaskPicker, type TaskPickerOption } from '@/components/common'
import {
  ADD_TASK_DEPENDENCY,
  graphqlClient,
  REMOVE_TASK_DEPENDENCY,
} from '@/graphql'
import { useBoardStore } from '@/store'
import type { TaskBlockerSummary, TaskDependenciesProps } from '@/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Pre-compute transitive dependents of `taskId` using a BFS over the
// board's task list. Used to grey out options that would close a cycle.
function computeTransitiveDependents(
  allTasks: Array<{ id: string; dependents?: TaskBlockerSummary[] }>,
  rootId: string,
): Set<string> {
  const byId = new Map(allTasks.map((t) => [t.id, t]))
  const visited = new Set<string>()
  const stack: string[] = [rootId]
  while (stack.length > 0) {
    const current = stack.pop() as string
    for (const d of byId.get(current)?.dependents ?? []) {
      if (!visited.has(d.id)) {
        visited.add(d.id)
        stack.push(d.id)
      }
    }
  }
  return visited
}

function parseGraphQLError(err: unknown): string {
  // graphql-request throws ClientError with response.errors[].message
  const e = err as {
    response?: {
      errors?: Array<{ message: string; extensions?: { code?: string } }>
    }
    message?: string
  }
  const gqlErr = e.response?.errors?.[0]
  if (gqlErr) {
    const code = gqlErr.extensions?.code
    if (code === 'DEPENDENCY_CYCLE')
      return 'Adding this dependency would create a cycle.'
    if (code === 'DEPENDENCY_SELF') return 'A task cannot depend on itself.'
    if (code === 'DEPENDENCY_CROSS_BOARD')
      return 'Cross-board dependencies are not supported.'
    return gqlErr.message
  }
  return (e as { message?: string }).message ?? 'Failed to update dependency.'
}

// React hook: sync chips when parent prop changes (subscription push).
function useMemoSyncBlockers(
  source: TaskBlockerSummary[],
  setter: (list: TaskBlockerSummary[]) => void,
) {
  useEffect(() => setter(source), [setter, source])
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: TaskBlockerSummary['agentStatus'] }) {
  // Match AgentStatusDot palette from TaskCard.tsx
  const color =
    status === 'SUCCESS'
      ? 'bg-success-400'
      : status === 'FAILED'
        ? 'bg-error-400'
        : status === 'RUNNING'
          ? 'bg-info-400 animate-pulse'
          : status === 'BLOCKED'
            ? 'bg-honey-400'
            : status === 'QUEUED'
              ? 'bg-honey-400 animate-pulse'
              : 'bg-gray-600'
  return (
    <span className={`inline-block size-1.5 shrink-0 rounded-full ${color}`} />
  )
}

function BlockerChip({
  blocker,
  removable,
  onRemove,
  onOpen,
}: {
  blocker: TaskBlockerSummary
  removable: boolean
  onRemove?: () => void
  onOpen: () => void
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-raised px-2 py-0.5 text-body-xs">
      <button
        className="flex items-center gap-1.5 hover:text-text-primary"
        onClick={onOpen}
        type="button"
      >
        <StatusDot status={blocker.agentStatus} />
        <span className="max-w-[14rem] truncate">{blocker.title}</span>
      </button>
      {removable && onRemove && (
        <button
          aria-label="Remove blocker"
          className="text-text-tertiary hover:text-error-400"
          onClick={onRemove}
          type="button"
        >
          ×
        </button>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TaskDependencies({
  taskId,
  blockers,
  dependents,
  blockReason,
}: TaskDependenciesProps) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingBlockers, setPendingBlockers] =
    useState<TaskBlockerSummary[]>(blockers)
  const [pendingDependents] = useState<TaskBlockerSummary[]>(dependents)

  const openDrawerView = useBoardStore((s) => s.openDrawerView)
  const allTasks = useBoardStore(
    (s) => s.board?.columns.flatMap((c) => c.tasks) ?? [],
  )

  // Keep local chip state in sync when parent re-renders with new blockers
  // (e.g. after subscription push).
  useMemoSyncBlockers(blockers, setPendingBlockers)

  const excludeIds = useMemo(() => {
    const set = new Set<string>([taskId])
    for (const b of pendingBlockers) set.add(b.id)
    return Array.from(set)
  }, [taskId, pendingBlockers])

  const cycleBlockedIds = useMemo(() => {
    return computeTransitiveDependents(allTasks, taskId)
  }, [allTasks, taskId])

  const options: TaskPickerOption[] = useMemo(
    () =>
      allTasks
        .filter((t) => !t.archived)
        .filter((t) => t.id !== taskId)
        .map((t) => ({
          agentStatus: t.agentStatus,
          disabled: cycleBlockedIds.has(t.id),
          disabledReason: cycleBlockedIds.has(t.id)
            ? 'Would create a cycle'
            : undefined,
          id: t.id,
          title: t.title,
        })),
    [allTasks, taskId, cycleBlockedIds],
  )

  const handleAdd = useCallback(
    async (blockerId: string | null) => {
      if (!blockerId) return
      setError(null)
      try {
        const result = await graphqlClient.request<{
          addTaskDependency: { id: string; blockers: TaskBlockerSummary[] }
        }>(ADD_TASK_DEPENDENCY, { blockerId, taskId })
        setPendingBlockers(result.addTaskDependency.blockers)
        setAdding(false)
      } catch (err) {
        const message = parseGraphQLError(err)
        setError(message)
        setTimeout(() => setError(null), 5_000)
      }
    },
    [taskId],
  )

  const handleRemove = useCallback(
    async (blockerId: string) => {
      const prev = pendingBlockers
      // Optimistic removal
      setPendingBlockers((list: TaskBlockerSummary[]) =>
        list.filter((b: TaskBlockerSummary) => b.id !== blockerId),
      )
      try {
        await graphqlClient.request<{
          removeTaskDependency: { id: string; blockers: TaskBlockerSummary[] }
        }>(REMOVE_TASK_DEPENDENCY, { blockerId, taskId })
      } catch (err) {
        // Roll back on failure
        setPendingBlockers(prev)
        setError(parseGraphQLError(err))
        setTimeout(() => setError(null), 5_000)
      }
    },
    [pendingBlockers, taskId],
  )

  return (
    <div className="flex flex-col gap-3">
      {blockReason === 'DEPENDENCY_FAILED' && (
        <div className="rounded-md border border-error-400/40 bg-error-400/10 p-2 text-body-xs text-text-secondary">
          A blocker failed. Remove the broken edge below and re-dispatch this
          task from the Agent panel, or resolve the blocker first.
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-body-xs text-text-tertiary">Blocked by</span>
        {pendingBlockers.length === 0 ? (
          <span className="text-body-xs text-text-tertiary italic">
            No blockers.
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {pendingBlockers.map((b: TaskBlockerSummary) => (
              <BlockerChip
                blocker={b}
                key={b.id}
                onOpen={() => openDrawerView(b.id)}
                onRemove={() => handleRemove(b.id)}
                removable
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-body-xs text-text-tertiary">Blocks</span>
        {pendingDependents.length === 0 ? (
          <span className="text-body-xs text-text-tertiary italic">
            No dependents.
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {pendingDependents.map((d: TaskBlockerSummary) => (
              <BlockerChip
                blocker={d}
                key={d.id}
                onOpen={() => openDrawerView(d.id)}
                removable={false}
              />
            ))}
          </div>
        )}
      </div>

      {adding ? (
        <div className="flex flex-col gap-2">
          <TaskPicker
            excludeIds={excludeIds}
            onChange={handleAdd}
            options={options}
            placeholder="Search tasks to block this one…"
            value={null}
          />
          <button
            className="self-end text-body-xs text-text-tertiary hover:text-text-primary"
            onClick={() => {
              setAdding(false)
              setError(null)
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="self-start text-body-xs text-text-tertiary hover:text-text-primary"
          onClick={() => setAdding(true)}
          type="button"
        >
          + Add blocker
        </button>
      )}

      {error && <span className="text-body-xs text-error-400">{error}</span>}
    </div>
  )
}
