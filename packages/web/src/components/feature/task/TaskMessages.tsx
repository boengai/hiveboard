import { useEffect, useMemo, useState } from 'react'
import {
  Avatar,
  Button,
  MarkdownPreview,
  TextAreaInput,
} from '@/components/common'
import { MessageIcon, ZapIcon } from '@/components/common/icon'
import {
  ANSWER_QUESTION,
  graphqlClient,
  MESSAGE_ADDED_SUBSCRIPTION,
  SEND_HINT,
  SEND_REDIRECT,
} from '@/graphql'
import { useTaskSubscription } from '@/hooks'
import type {
  ComposerMode,
  ComposerProps,
  MessageAddedPayload,
  TaskMessage,
  TaskMessageKind,
  TaskMessagesProps,
} from '@/types'
import { timeAgo } from './TaskEventHistory'

// ---------------------------------------------------------------------------
// Kind theming — left ribbon + soft tint per kind, label color
// ---------------------------------------------------------------------------

type KindStyle = { ribbon: string; tint: string; label: string }

const KIND_STYLE: Record<TaskMessageKind, KindStyle> = {
  ANSWER: {
    label: 'text-success-400',
    ribbon: 'before:bg-success-400/70',
    tint: 'bg-success-400/[0.04]',
  },
  HINT: {
    label: 'text-text-tertiary',
    ribbon: 'before:bg-gray-600',
    tint: 'bg-surface-overlay/40',
  },
  QUESTION: {
    label: 'text-honey-300',
    ribbon: 'before:bg-honey-400',
    tint: 'bg-honey-500/[0.06]',
  },
  REDIRECT: {
    label: 'text-warning-400',
    ribbon: 'before:bg-warning-400/80',
    tint: 'bg-warning-400/[0.05]',
  },
}

const KIND_LABEL: Record<TaskMessageKind, string> = {
  ANSWER: 'Answer',
  HINT: 'Hint',
  QUESTION: 'Question',
  REDIRECT: 'Redirect',
}

// ---------------------------------------------------------------------------
// Author marker — bee-styled disc for agent, Avatar for human
// ---------------------------------------------------------------------------

function AgentMark() {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-honey-500/15 text-honey-300 ring-1 ring-honey-400/30 ring-inset">
      <MessageIcon size={12} />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({
  message,
  isActiveQuestion,
}: {
  message: TaskMessage
  isActiveQuestion: boolean
}) {
  const isHuman = message.authorType === 'HUMAN'
  const authorName =
    message.createdBy?.displayName ??
    message.createdBy?.username ??
    (isHuman ? 'You' : 'Agent')
  const undelivered = isHuman && message.deliveredAt === null
  const style = KIND_STYLE[message.kind]
  const wantsAttention = isActiveQuestion && message.kind === 'QUESTION'

  // Agent on the left, human on the right; marker sits on the bubble's outer side.
  return (
    <div
      className="flex w-full items-start gap-2 data-[author=human]:flex-row-reverse"
      data-author={isHuman ? 'human' : 'agent'}
    >
      {isHuman ? (
        <Avatar name={message.createdBy?.username ?? 'You'} />
      ) : (
        <AgentMark />
      )}

      <div
        className="group flex min-w-0 max-w-[80%] flex-1 flex-col items-start gap-1 data-[author=human]:items-end"
        data-author={isHuman ? 'human' : 'agent'}
      >
        {/* meta line */}
        <div className="flex items-center gap-1.5 px-1 text-body-xs">
          <span
            className={`font-medium uppercase tracking-wider ${style.label}`}
          >
            {KIND_LABEL[message.kind]}
          </span>
          <span className="text-text-tertiary">·</span>
          <span className="text-text-secondary">{authorName}</span>
          <span className="text-text-tertiary">·</span>
          <span className="text-text-tertiary">
            {timeAgo(message.createdAt)}
          </span>
        </div>

        {/* bubble */}
        <div
          className={[
            // structural — keep the horizontal-overflow fix
            'relative w-full min-w-0 overflow-hidden',
            // visual frame
            'rounded-lg border border-border-default px-4 py-3',
            style.ribbon,
            style.tint,
            // active question: subtle honey glow + brighter border
            wantsAttention &&
              'border-honey-400/40 shadow-[0_0_0_1px_var(--color-honey-400)/_0.10] shadow-glow-honey',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <MarkdownPreview content={message.body} />
        </div>

        {undelivered && (
          <span className="inline-flex items-center gap-1.5 px-1 text-body-xs text-text-tertiary">
            <span className="size-1.5 animate-pulse rounded-full bg-honey-400/70" />
            queued — will deliver on next spawn
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function Composer({
  taskId,
  mode,
  agentStatus,
  currentQuestion,
}: ComposerProps) {
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<'HINT' | 'REDIRECT'>('HINT')
  const [submitting, setSubmitting] = useState(false)
  const [pendingRedirect, setPendingRedirect] = useState(false)

  const reset = () => {
    setBody('')
    setPendingRedirect(false)
  }

  const sendHint = async (trimmed: string) => {
    await graphqlClient.request(SEND_HINT, { body: trimmed, taskId })
  }

  const sendRedirect = async (trimmed: string) => {
    await graphqlClient.request(SEND_REDIRECT, { body: trimmed, taskId })
  }

  const sendAnswer = async (trimmed: string) => {
    await graphqlClient.request(ANSWER_QUESTION, { body: trimmed, taskId })
  }

  const handleSubmit = async () => {
    const trimmed = body.trim()
    if (!trimmed) return

    if (
      mode === 'HINT_OR_REDIRECT' &&
      kind === 'REDIRECT' &&
      agentStatus === 'RUNNING' &&
      !pendingRedirect
    ) {
      setPendingRedirect(true)
      return
    }

    setSubmitting(true)
    try {
      if (mode === 'ANSWER') {
        await sendAnswer(trimmed)
      } else if (kind === 'HINT') {
        await sendHint(trimmed)
      } else {
        await sendRedirect(trimmed)
      }
      reset()
    } catch (err) {
      console.error('TaskMessages composer error', err)
    } finally {
      setSubmitting(false)
    }
  }

  // ANSWER mode — compact, focused on the active question.
  if (mode === 'ANSWER') {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-honey-400/40 bg-honey-500/[0.06] p-3 shadow-glow-honey">
        <div className="flex items-center gap-1.5 text-body-xs">
          <span className="size-1.5 animate-pulse rounded-full bg-honey-400" />
          <span className="font-medium text-honey-300 uppercase tracking-wider">
            Answering question
          </span>
        </div>
        <TextAreaInput
          onChange={(v: string) => setBody(v)}
          placeholder="Write your answer…"
          rows={4}
          value={body}
        />
        <div className="flex justify-end">
          <Button
            color="primary"
            disabled={!body.trim() || submitting}
            onClick={handleSubmit}
            size="small"
          >
            {submitting ? 'Sending…' : 'Send answer'}
          </Button>
        </div>
      </div>
    )
  }

  // HINT_OR_REDIRECT — segmented toggle + textarea.
  const explainer =
    kind === 'HINT'
      ? 'Non-urgent nudge — delivered next time the agent spawns.'
      : 'Urgent — aborts the running agent and requeues with this guidance.'

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-default bg-surface-overlay/30 p-3">
      {/* Segmented kind toggle */}
      <div className="flex items-center gap-1 rounded-md bg-surface-inset p-0.5">
        <button
          aria-pressed={kind === 'HINT'}
          className={[
            'flex-1 rounded px-2 py-1 text-body-xs transition-colors',
            kind === 'HINT'
              ? 'bg-surface-overlay text-text-primary shadow-xs'
              : 'text-text-tertiary hover:text-text-secondary',
          ].join(' ')}
          onClick={() => {
            setKind('HINT')
            setPendingRedirect(false)
          }}
          type="button"
        >
          Hint
        </button>
        <button
          aria-pressed={kind === 'REDIRECT'}
          className={[
            'flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-body-xs transition-colors',
            kind === 'REDIRECT'
              ? 'bg-warning-400/15 text-warning-400 shadow-xs'
              : 'text-text-tertiary hover:text-text-secondary',
          ].join(' ')}
          onClick={() => setKind('REDIRECT')}
          type="button"
        >
          <ZapIcon size={11} />
          Redirect
        </button>
      </div>

      <TextAreaInput
        onChange={(v: string) => {
          setBody(v)
          if (pendingRedirect) setPendingRedirect(false)
        }}
        placeholder={
          kind === 'HINT'
            ? 'Leave a hint for the agent…'
            : 'Write a redirect message…'
        }
        rows={4}
        value={body}
      />

      <p className="px-0.5 text-body-xs text-text-tertiary">{explainer}</p>

      {pendingRedirect && (
        <div className="flex items-start gap-2 rounded-md border border-warning-400/40 bg-warning-400/10 p-2 text-body-xs text-text-primary">
          <ZapIcon size={12} />
          <span>
            This will abort the running agent and requeue the task. Confirm to
            proceed.
          </span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {pendingRedirect && (
          <Button
            onClick={() => setPendingRedirect(false)}
            size="small"
            variant="ghost"
          >
            Cancel
          </Button>
        )}
        <Button
          color={kind === 'REDIRECT' ? 'warning' : 'primary'}
          disabled={!body.trim() || submitting}
          onClick={handleSubmit}
          size="small"
        >
          {submitting
            ? 'Sending…'
            : pendingRedirect
              ? 'Confirm redirect'
              : kind === 'HINT'
                ? 'Send hint'
                : 'Send redirect'}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border-default border-dashed bg-surface-overlay/20 px-4 py-6 text-center">
      <span className="flex size-8 items-center justify-center rounded-full bg-honey-500/10 text-honey-300">
        <MessageIcon size={16} />
      </span>
      <div className="flex flex-col gap-0.5">
        <p className="text-body-sm text-text-secondary">No messages yet</p>
        <p className="text-body-xs text-text-tertiary">
          Drop a hint to nudge the agent, or wait for it to ask a question.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TaskMessages({
  taskId,
  agentStatus,
  currentQuestion,
  initialMessages,
}: TaskMessagesProps) {
  const [messages, setMessages] = useState<TaskMessage[]>(initialMessages)

  useEffect(() => {
    setMessages(initialMessages)
  }, [initialMessages])

  useTaskSubscription<MessageAddedPayload>(
    MESSAGE_ADDED_SUBSCRIPTION,
    { taskId },
    (data) => {
      const incoming = data.messageAdded
      if (!incoming || incoming.taskId !== taskId) return
      setMessages((prev: TaskMessage[]) => {
        if (prev.some((m: TaskMessage) => m.id === incoming.id)) return prev
        return [...prev, incoming]
      })
    },
  )

  const sorted = useMemo(
    () =>
      [...messages].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [messages],
  )

  const blocked = agentStatus === 'BLOCKED' && currentQuestion !== null
  const mode: ComposerMode = blocked ? 'ANSWER' : 'HINT_OR_REDIRECT'

  // The question bubble that wants attention is the one matching the active
  // currentQuestion id (or, falling back, the latest QUESTION when blocked).
  const activeQuestionId = blocked ? (currentQuestion?.id ?? null) : null

  return (
    <div className="flex flex-col gap-3">
      {/* Thread */}
      {sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((message: TaskMessage) => (
            <MessageBubble
              isActiveQuestion={message.id === activeQuestionId}
              key={message.id}
              message={message}
            />
          ))}
        </div>
      )}

      {/* Composer */}
      <Composer
        agentStatus={agentStatus}
        currentQuestion={currentQuestion}
        mode={mode}
        taskId={taskId}
      />
    </div>
  )
}
