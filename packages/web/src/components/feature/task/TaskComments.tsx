import { useCallback, useEffect, useState } from 'react'
import {
  Avatar,
  Button,
  MarkdownPreview,
  TextAreaInput,
} from '@/components/common'
import {
  ADD_COMMENT,
  COMMENT_ADDED_SUBSCRIPTION,
  DELETE_COMMENT,
  GET_COMMENTS,
  graphqlClient,
  subscribe,
  UPDATE_COMMENT,
} from '@/graphql'
import type {
  Comment,
  CommentBlockProps,
  Reply,
  TaskCommentsProps,
} from '@/types'
import { timeAgo } from './TaskTimeline'

function CommentBlock({
  taskId,
  comment,
  onDeleted,
  onUpdated,
  onReplyAdded,
}: CommentBlockProps) {
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showReplyInput, setShowReplyInput] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)

  const handleSave = async () => {
    const trimmed = editBody.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await graphqlClient.request<{
        updateComment: { id: string; body: string; updatedAt: string }
      }>(UPDATE_COMMENT, { body: trimmed, id: comment.id })
      onUpdated(comment.id, trimmed)
      setEditing(false)
    } catch (err) {
      console.error('CommentBlock save error', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('Delete this comment?')) return
    setDeleting(true)
    try {
      await graphqlClient.request(DELETE_COMMENT, { id: comment.id })
      onDeleted(comment.id)
    } catch (err) {
      console.error('CommentBlock delete error', err)
      setDeleting(false)
    }
  }

  const handleReply = async () => {
    const trimmed = replyBody.trim()
    if (!trimmed) return
    setReplySubmitting(true)
    try {
      const data = await graphqlClient.request<{ addComment: Reply }>(
        ADD_COMMENT,
        {
          body: trimmed,
          parentId: comment.id,
          taskId,
        },
      )
      onReplyAdded(comment.id, data.addComment)
      setReplyBody('')
      setShowReplyInput(false)
    } catch (err) {
      console.error('CommentBlock reply error', err)
    } finally {
      setReplySubmitting(false)
    }
  }

  return (
    <div className="rounded-lg border border-border-default bg-surface-overlay/30 p-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatar name={comment.createdBy.username} />
          <span className="font-medium text-body-sm text-text-primary">
            {comment.createdBy.username}
          </span>
          <span className="text-body-xs text-text-tertiary">
            {timeAgo(comment.createdAt)}
          </span>
        </div>
        {!editing && (
          <div className="flex items-center gap-1">
            <Button
              color="ghost"
              onClick={() => setShowReplyInput(!showReplyInput)}
              size="small"
            >
              Reply
            </Button>
            <Button
              color="ghost"
              onClick={() => {
                setEditBody(comment.body)
                setEditing(true)
              }}
              size="small"
            >
              Edit
            </Button>
            <Button
              color="danger"
              disabled={deleting}
              onClick={handleDelete}
              size="small"
            >
              {deleting ? '…' : 'Delete'}
            </Button>
          </div>
        )}
      </div>

      {/* Body or edit textarea */}
      <div className="mt-2">
        {editing ? (
          <div className="flex flex-col gap-2">
            <TextAreaInput
              onChange={(e) => setEditBody(e.target.value)}
              rows={2}
              value={editBody}
            />
            <div className="flex gap-2">
              <Button
                color="primary"
                disabled={!editBody.trim() || saving}
                onClick={handleSave}
                size="small"
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                color="ghost"
                onClick={() => {
                  setEditing(false)
                  setEditBody(comment.body)
                }}
                size="small"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-body-sm text-text-secondary">
            <MarkdownPreview content={comment.body} />
          </div>
        )}
      </div>

      {/* Threaded replies (max 1 level) */}
      {comment.replies.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-border-default border-l-2 pl-3">
          {comment.replies.map((reply) => (
            <ReplyBlock
              key={reply.id}
              onDeleted={(id) => onDeleted(id)}
              reply={reply}
            />
          ))}
        </div>
      )}

      {/* Inline reply input */}
      {showReplyInput && (
        <div className="mt-3 flex flex-col gap-2 border-honey-400/30 border-l-2 pl-3">
          <TextAreaInput
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write a reply…"
            rows={2}
            value={replyBody}
          />
          <div className="flex gap-2">
            <Button
              color="primary"
              disabled={!replyBody.trim() || replySubmitting}
              onClick={handleReply}
              size="small"
            >
              {replySubmitting ? 'Replying…' : 'Reply'}
            </Button>
            <Button
              color="ghost"
              onClick={() => {
                setShowReplyInput(false)
                setReplyBody('')
              }}
              size="small"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReplyBlock
// ---------------------------------------------------------------------------

function ReplyBlock({
  reply,
  onDeleted,
}: {
  reply: Reply
  onDeleted: (id: string) => void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!window.confirm('Delete this reply?')) return
    setDeleting(true)
    try {
      await graphqlClient.request(DELETE_COMMENT, { id: reply.id })
      onDeleted(reply.id)
    } catch (err) {
      console.error('ReplyBlock delete error', err)
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 py-1">
      <div className="flex items-center gap-2">
        <Avatar name={reply.createdBy.username} size="sm" />
        <span className="font-medium text-body-xs text-text-primary">
          {reply.createdBy.username}
        </span>
        <span className="text-body-xs text-text-tertiary">
          {timeAgo(reply.createdAt)}
        </span>
        <button
          className="ml-auto text-body-xs text-text-tertiary opacity-0 transition-opacity hover:text-error-400 group-hover/reply:opacity-100"
          disabled={deleting}
          onClick={handleDelete}
          type="button"
        >
          {deleting ? '…' : 'Delete'}
        </button>
      </div>
      <div className="pl-7 text-body-sm text-text-secondary">
        <MarkdownPreview content={reply.body} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TaskComments({ taskId }: TaskCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [newBody, setNewBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchComments = useCallback(async () => {
    setLoading(true)
    try {
      const data = await graphqlClient.request<{ comments: Comment[] }>(
        GET_COMMENTS,
        { taskId },
      )
      setComments(data.comments.filter((c) => !c.parentId))
    } catch (err) {
      console.error('TaskComments fetch error', err)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    fetchComments()
  }, [fetchComments])

  // Subscribe to new comments added by other sessions
  useEffect(() => {
    const dispose = subscribe<{ commentAdded: Comment }>(
      COMMENT_ADDED_SUBSCRIPTION,
      { taskId },
      (data) => {
        const incoming = data.commentAdded
        if (!incoming) return
        // Only top-level comments arrive here; skip replies (parentId set)
        if (incoming.parentId) return
        setComments((prev) => {
          // Avoid duplicates (e.g. our own optimistic add)
          if (prev.some((c) => c.id === incoming.id)) return prev
          return [...prev, incoming]
        })
      },
    )
    return dispose
  }, [taskId])

  const handleAddComment = async () => {
    const trimmed = newBody.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      const data = await graphqlClient.request<{ addComment: Comment }>(
        ADD_COMMENT,
        {
          body: trimmed,
          taskId,
        },
      )
      setComments((prev) => [...prev, data.addComment])
      setNewBody('')
    } catch (err) {
      console.error('TaskComments add error', err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleted = (id: string) => {
    setComments((prev) =>
      prev
        .filter((c) => c.id !== id)
        .map((c) => ({ ...c, replies: c.replies.filter((r) => r.id !== id) })),
    )
  }

  const handleUpdated = (id: string, body: string) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, body } : c)))
  }

  const handleReplyAdded = (parentId: string, reply: Reply) => {
    setComments((prev) =>
      prev.map((c) =>
        c.id === parentId ? { ...c, replies: [...c.replies, reply] } : c,
      ),
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div
              className="h-16 animate-pulse rounded-lg bg-surface-overlay"
              key={i}
            />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p className="text-body-xs text-text-tertiary">No comments yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {comments.map((comment) => (
            <CommentBlock
              comment={comment}
              key={comment.id}
              onDeleted={handleDeleted}
              onReplyAdded={handleReplyAdded}
              onUpdated={handleUpdated}
              taskId={taskId}
            />
          ))}
        </div>
      )}

      {/* New comment input */}
      <div className="flex flex-col gap-2 rounded-lg border border-border-default bg-surface-overlay/20 p-3">
        <TextAreaInput
          onChange={(e) => setNewBody(e.target.value)}
          placeholder="Leave a comment…"
          rows={2}
          value={newBody}
        />
        <div className="flex justify-end">
          <Button
            color="primary"
            disabled={!newBody.trim() || submitting}
            onClick={handleAddComment}
            size="small"
          >
            {submitting ? 'Commenting…' : 'Comment'}
          </Button>
        </div>
      </div>
    </div>
  )
}
