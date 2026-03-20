import { useState, useEffect } from 'react'
import { graphqlClient } from '@/graphql/client'
import { GET_COMMENTS } from '@/graphql/queries'
import { ADD_COMMENT, UPDATE_COMMENT, DELETE_COMMENT } from '@/graphql/mutations'
import { timeAgo } from './TaskTimeline'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommentUser {
  id: string
  username: string
  displayName: string
}

interface Reply {
  id: string
  body: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  createdBy: CommentUser
}

interface Comment {
  id: string
  body: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  createdBy: CommentUser
  replies: Reply[]
}

// ---------------------------------------------------------------------------
// CommentBlock
// ---------------------------------------------------------------------------

interface CommentBlockProps {
  taskId: string
  comment: Comment
  onDeleted: (id: string) => void
  onUpdated: (id: string, body: string) => void
  onReplyAdded: (parentId: string, reply: Reply) => void
}

function CommentBlock({ taskId, comment, onDeleted, onUpdated, onReplyAdded }: CommentBlockProps) {
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
      await graphqlClient.request<{ updateComment: { id: string; body: string; updatedAt: string } }>(
        UPDATE_COMMENT,
        { id: comment.id, body: trimmed }
      )
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
      const data = await graphqlClient.request<{ addComment: Reply }>(ADD_COMMENT, {
        taskId,
        body: trimmed,
        parentId: comment.id,
      })
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
        <span className="text-body-xs font-medium text-text-primary">{comment.createdBy.username}</span>
        <div className="flex items-center gap-2">
          <span className="text-body-xs text-text-tertiary">{timeAgo(comment.createdAt)}</span>
          {!editing && (
            <>
              <button
                className="text-body-xs text-text-tertiary hover:text-text-secondary focus:outline-none"
                onClick={() => { setEditBody(comment.body); setEditing(true) }}
              >
                Edit
              </button>
              <button
                disabled={deleting}
                className="text-body-xs text-error-400 hover:text-error-300 disabled:opacity-50 focus:outline-none"
                onClick={handleDelete}
              >
                {deleting ? '…' : 'Delete'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body or edit textarea */}
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <textarea
            className="min-h-[60px] resize-y rounded-md border border-border-default bg-surface-base px-3 py-2 text-body-sm text-text-primary outline-none focus:border-honey-400 focus:shadow-glow-honey"
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              disabled={!editBody.trim() || saving}
              onClick={handleSave}
              className="rounded-md bg-honey-400 px-3 py-1 text-body-xs font-medium text-gray-900 hover:bg-honey-300 disabled:opacity-50 focus:outline-none focus:shadow-glow-honey"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditing(false); setEditBody(comment.body) }}
              className="rounded-md px-3 py-1 text-body-xs text-text-secondary hover:text-text-primary focus:outline-none"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-body-sm text-text-secondary">{comment.body}</p>
      )}

      {/* Reply button */}
      {!editing && (
        <button
          className="self-start text-body-xs text-text-tertiary hover:text-text-secondary focus:outline-none"
          onClick={() => setShowReplyInput(!showReplyInput)}
        >
          {showReplyInput ? 'Cancel' : 'Reply'}
        </button>
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
          <textarea
            className="min-h-[60px] resize-y rounded-md border border-border-default bg-surface-base px-3 py-2 text-body-sm text-text-primary outline-none focus:border-honey-400 focus:shadow-glow-honey"
            placeholder="Write a reply…"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              disabled={!replyBody.trim() || replySubmitting}
              onClick={handleReply}
              className="rounded-md bg-honey-400 px-3 py-1 text-body-xs font-medium text-gray-900 hover:bg-honey-300 disabled:opacity-50 focus:outline-none focus:shadow-glow-honey"
            >
              {replySubmitting ? 'Replying…' : 'Reply'}
            </button>
            <button
              onClick={() => { setShowReplyInput(false); setReplyBody('') }}
              className="rounded-md px-3 py-1 text-body-xs text-text-secondary hover:text-text-primary focus:outline-none"
            >
              Cancel
            </button>
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
        <span className="text-body-xs font-medium text-text-primary">{reply.createdBy.username}</span>
        <div className="flex items-center gap-2">
          <span className="text-body-xs text-text-tertiary">{timeAgo(reply.createdAt)}</span>
          <button
            disabled={deleting}
            className="text-body-xs text-error-400 hover:text-error-300 disabled:opacity-50 focus:outline-none"
            onClick={handleDelete}
          >
            {deleting ? '…' : 'Delete'}
          </button>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-body-sm text-text-secondary">{reply.body}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface TaskCommentsProps {
  taskId: string
}

export function TaskComments({ taskId }: TaskCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [newBody, setNewBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchComments = async () => {
    setLoading(true)
    try {
      const data = await graphqlClient.request<{ comments: Comment[] }>(GET_COMMENTS, { taskId })
      setComments(data.comments.filter((c) => !c.parentId))
    } catch (err) {
      console.error('TaskComments fetch error', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchComments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  const handleAddComment = async () => {
    const trimmed = newBody.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      const data = await graphqlClient.request<{ addComment: Comment }>(ADD_COMMENT, {
        taskId,
        body: trimmed,
      })
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
        .map((c) => ({ ...c, replies: c.replies.filter((r) => r.id !== id) }))
    )
  }

  const handleUpdated = (id: string, body: string) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, body } : c)))
  }

  const handleReplyAdded = (parentId: string, reply: Reply) => {
    setComments((prev) =>
      prev.map((c) =>
        c.id === parentId ? { ...c, replies: [...c.replies, reply] } : c
      )
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
            <div key={i} className="h-12 animate-pulse rounded bg-surface-overlay" />
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
        <textarea
          className="min-h-[72px] resize-y rounded-md border border-border-default bg-surface-base px-3 py-2 text-body-sm text-text-primary outline-none focus:border-honey-400 focus:shadow-glow-honey"
          placeholder="Leave a comment…"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
        />
        <button
          disabled={!newBody.trim() || submitting}
          onClick={handleAddComment}
          className="self-start rounded-md bg-honey-400 px-4 py-1.5 text-body-sm font-medium text-gray-900 hover:bg-honey-300 disabled:opacity-50 focus:outline-none focus:shadow-glow-honey"
        >
          {submitting ? 'Commenting…' : 'Comment'}
        </button>
      </div>
    </div>
  )
}
