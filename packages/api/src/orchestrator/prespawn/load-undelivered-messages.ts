import type { Database } from 'bun:sqlite'
import { listUndeliveredHumanMessages } from '../../db/task-messages'
import { escapeMustacheSyntax } from '../mustache-escape'
import type { PromptMessage } from './types'

export type LoadUndeliveredMessagesResult = {
  messages: PromptMessage[]
  deliveredMessageIds: string[]
}

type DeliverableKind = 'hint' | 'redirect' | 'answer'
const DELIVERABLE_KINDS: ReadonlySet<DeliverableKind> = new Set([
  'hint',
  'redirect',
  'answer',
])

export function loadUndeliveredMessages(
  db: Database,
  taskId: string,
): LoadUndeliveredMessagesResult {
  // Drop kinds that aren't deliverable to the agent prompt. Today only
  // 'question' is excluded (it's agent-authored anyway — defensive); the
  // allowlist guarantees that any future MessageKind addition stays out
  // of the prompt until it's explicitly opted in here.
  const rows = listUndeliveredHumanMessages(db, taskId).filter(
    (m): m is typeof m & { kind: DeliverableKind } =>
      DELIVERABLE_KINDS.has(m.kind as DeliverableKind),
  )
  return {
    messages: rows.map((m) => ({
      body: escapeMustacheSyntax(m.body),
      created_at: m.createdAt,
      kind: m.kind,
    })),
    deliveredMessageIds: rows.map((m) => m.id),
  }
}
