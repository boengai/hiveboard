import { useEffect, useMemo, useState } from 'react'
import { Button, MarkdownPreview, TextAreaInput } from '@/components/common'
import {
  ANSWER_QUESTION,
  graphqlClient,
  MESSAGE_ADDED_SUBSCRIPTION,
  SEND_HINT,
  SEND_REDIRECT,
  subscribe,
} from '@/graphql'
import type {
  MessageAddedPayload,
  TaskMessage,
  TaskMessageKind,
  TaskMessagesProps,
} from '@/types'
import { timeAgo } from './TaskEventHistory'

// ---------------------------------------------------------------------------
// Kind chip
// ---------------------------------------------------------------------------

const KIND_CHIP_CLASSES: Record<TaskMessageKind, string> = {
  ANSWER: 'bg-success-400/15 text-success-400',
  HINT: 'bg-surface-overlay text-text-secondary',
  QUESTION:
    'bg-honey-500/30 text-honey-300 ring-1 ring-honey-400/60 ring-inset',
  REDIRECT: 'bg-honey-400/20 text-honey-400',
}

const KIND_LABEL: Record<TaskMessageKind, string> = {
  ANSWER: 'Answer',
  HINT: 'Hint',
  QUESTION: 'Question',
  REDIRECT: 'Redirect',
}

function KindChip({ kind }: { kind: TaskMessageKind }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide ${KIND_CHIP_CLASSES[kind]}`}
    >
      {KIND_LABEL[kind]}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: TaskMessage }) {
  const isHuman = message.authorType === 'HUMAN'
  const authorName =
    message.createdBy?.displayName ??
    message.createdBy?.username ??
    (isHuman ? 'You' : 'Agent')
  const undelivered = isHuman && message.deliveredAt === null

  return (
    <div className={`flex w-full ${isHuman ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`flex max-w-[85%] flex-col gap-1 ${isHuman ? 'items-end' : 'items-start'}`}
      >
        <div className="flex items-center gap-1.5 px-1">
          <KindChip kind={message.kind} />
          <span className="text-body-xs text-text-tertiary">{authorName}</span>
          <span className="text-body-xs text-text-tertiary">·</span>
          <span className="text-body-xs text-text-tertiary">
            {timeAgo(message.createdAt)}
          </span>
        </div>
        <div
          className={`rounded-lg border px-3 py-2 text-body-sm ${
            isHuman
              ? 'border-honey-400/30 bg-honey-400/10 text-text-primary'
              : 'border-border-default bg-surface-overlay/50 text-text-primary'
          }`}
        >
          <MarkdownPreview content={message.body} />
        </div>
        {undelivered && (
          <span className="px-1 text-body-xs text-text-tertiary italic">
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

type ComposerMode = 'ANSWER' | 'HINT_OR_REDIRECT'

type ComposerProps = {
  taskId: string
  mode: ComposerMode
  agentStatus: string
  currentQuestion: TaskMessagesProps['currentQuestion']
}

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

    // Redirect + running agent → confirm step
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

  if (mode === 'ANSWER') {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-honey-400/40 bg-surface-overlay/30 p-3">
        {currentQuestion && (
          <div className="rounded-md border border-honey-400/50 bg-honey-500/10 p-2">
            <div className="font-medium text-[10px] text-honey-300 uppercase tracking-wide">
              Waiting for your answer
            </div>
            <div className="mt-1 text-body-sm text-text-primary">
              {currentQuestion.body}
            </div>
          </div>
        )}
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
            {submitting ? 'Answering…' : 'Send answer'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-default bg-surface-overlay/20 p-3">
      {/* Kind selector */}
      <div className="flex gap-1">
        <Button
          color={kind === 'HINT' ? 'primary' : 'default'}
          onClick={() => {
            setKind('HINT')
            setPendingRedirect(false)
          }}
          size="small"
          variant={kind === 'HINT' ? 'solid' : 'ghost'}
        >
          Hint
        </Button>
        <Button
          color={kind === 'REDIRECT' ? 'primary' : 'default'}
          onClick={() => setKind('REDIRECT')}
          size="small"
          variant={kind === 'REDIRECT' ? 'solid' : 'ghost'}
        >
          Redirect
        </Button>
        <span className="ml-1 self-center text-body-xs text-text-tertiary">
          {kind === 'HINT'
            ? 'Non-urgent nudge, delivered on next spawn.'
            : 'Urgent — aborts running agent and requeues.'}
        </span>
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

      {pendingRedirect && (
        <div className="rounded-md border border-honey-400/50 bg-honey-400/10 p-2 text-body-xs text-text-primary">
          This will abort the running agent and requeue the task. Confirm to
          proceed.
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
          color="primary"
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

  useEffect(() => {
    const dispose = subscribe<MessageAddedPayload>(
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
    return dispose
  }, [taskId])

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

  return (
    <div className="flex flex-col gap-3">
      {/* Banner shown above the thread when blocked */}
      {blocked && currentQuestion && (
        <div className="rounded-lg border border-honey-400/50 bg-honey-500/10 p-3">
          <div className="font-medium text-body-xs text-honey-300 uppercase tracking-wide">
            Waiting for your answer
          </div>
          <div className="mt-1 text-body-sm text-text-primary">
            {currentQuestion.body}
          </div>
        </div>
      )}

      {/* Thread */}
      {sorted.length === 0 ? (
        <p className="text-body-xs text-text-tertiary">No messages yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((message: TaskMessage) => (
            <MessageBubble key={message.id} message={message} />
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
