import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/common/button'
import { TextAreaInput } from '@/components/common/input'
import { MarkdownPreview } from '@/components/common/markdown'
import { graphqlClient } from '@/graphql/client'
import {
  ADD_COMMENT,
  DELETE_COMMENT,
  UPDATE_COMMENT,
} from '@/graphql/mutations'
import { GET_COMMENTS } from '@/graphql/queries'
import { COMMENT_ADDED_SUBSCRIPTION, subscribe } from '@/graphql/subscriptions'
import type {
  Comment,
  CommentBlockProps,
  Reply,
  TaskCommentsProps,
} from '@/types/components/feature/task'
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
      }>(UPDATE_COMMENT, { id: comment.id, body: trimmed })
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
          taskId,
          body: trimmed,
          parentId: comment.id,
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
    <div className="flex flex-col gap-1.5 py-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-body-xs font-medium text-text-primary">
          {comment.createdBy.username}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-body-xs text-text-tertiary">
            {timeAgo(comment.createdAt)}
          </span>
          {!editing && (
            <>
              <Button
                size="small"
                color="ghost"
                onClick={() => {
                  setEditBody(comment.body)
                  setEditing(true)
                }}
              >
                Edit
              </Button>
              <Button
                size="small"
                color="danger"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? '…' : 'Delete'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Body or edit textarea */}
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <TextAreaInput
            rows={2}
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="small"
              color="primary"
              disabled={!editBody.trim() || saving}
              onClick={handleSave}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              size="small"
              color="ghost"
              onClick={() => {
                setEditing(false)
                setEditBody(comment.body)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <MarkdownPreview content={comment.body} />
      )}

      {/* Reply button */}
      {!editing && (
        <div className="self-start">
          <Button
            size="small"
            color="ghost"
            onClick={() => setShowReplyInput(!showReplyInput)}
          >
            {showReplyInput ? 'Cancel' : 'Reply'}
          </Button>
        </div>
      )}

      {/* Threaded replies (max 1 level) */}
      {comment.replies.length > 0 && (
        <div className="ml-4 flex flex-col gap-2 border-l border-border-default pl-3">
          {comment.replies.map((reply) => (
            <ReplyBlock
              key={reply.id}
              reply={reply}
              onDeleted={(id) => onDeleted(id)}
            />
          ))}
        </div>
      )}

      {/* Inline reply input */}
      {showReplyInput && (
        <div className="ml-4 flex flex-col gap-1.5 border-l border-border-default pl-3">
          <TextAreaInput
            rows={2}
            placeholder="Write a reply…"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="small"
              color="primary"
              disabled={!replyBody.trim() || replySubmitting}
              onClick={handleReply}
            >
              {replySubmitting ? 'Replying…' : 'Reply'}
            </Button>
            <Button
              size="small"
              color="ghost"
              onClick={() => {
                setShowReplyInput(false)
                setReplyBody('')
              }}
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
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-body-xs font-medium text-text-primary">
          {reply.createdBy.username}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-body-xs text-text-tertiary">
            {timeAgo(reply.createdAt)}
          </span>
          <Button
            size="small"
            color="danger"
            className="text-body-xs"
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? '…' : 'Delete'}
          </Button>
        </div>
      </div>
      <MarkdownPreview content={reply.body} />
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
          taskId,
          body: trimmed,
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
      <span className="text-body-xs font-medium text-text-secondary uppercase tracking-wide">
        Comments
      </span>

      {loading ? (
        <div className="flex flex-col gap-1">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded bg-surface-overlay"
            />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p className="text-body-xs text-text-tertiary">No comments yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border-default/50">
          {comments.map((comment) => (
            <CommentBlock
              key={comment.id}
              taskId={taskId}
              comment={comment}
              onDeleted={handleDeleted}
              onUpdated={handleUpdated}
              onReplyAdded={handleReplyAdded}
            />
          ))}
        </div>
      )}

      {/* New comment input */}
      <div className="flex flex-col gap-1.5 pt-1">
        <TextAreaInput
          rows={3}
          placeholder="Leave a comment…"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
        />
        <div className="self-start">
          <Button
            size="small"
            color="primary"
            disabled={!newBody.trim() || submitting}
            onClick={handleAddComment}
          >
            {submitting ? 'Commenting…' : 'Comment'}
          </Button>
        </div>
      </div>
    </div>
  )
}
