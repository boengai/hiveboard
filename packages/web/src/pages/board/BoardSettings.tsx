import { Link, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { ArrowIcon } from '@/components'
import { GET_BOARD, graphqlClient } from '@/graphql'
import type { Board } from '@/types'
import { Secrets } from './settings'

export function BoardSettings() {
  const { boardId } = useParams({ strict: false }) as { boardId?: string }
  const id = boardId ?? ''

  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBoard = useCallback(async () => {
    if (!id) return
    try {
      setLoading(true)
      const data = await graphqlClient.request<{ board: Board }>(GET_BOARD, {
        id,
      })
      setBoard(data.board ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load board')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchBoard()
  }, [fetchBoard])

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="h-7 w-64 animate-pulse rounded bg-surface-overlay" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-md bg-error-400/10 px-4 py-3 text-body-sm text-error-400">
          Error: {error}
        </div>
      </div>
    )
  }

  if (!board) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-body-sm text-text-tertiary">
        Board not found.
      </div>
    )
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <div className="mb-2 flex items-center gap-1">
          <Link className="text-honey-400 hover:underline" to="/">
            <ArrowIcon />
          </Link>
          <span className="text-body-sm text-text-tertiary">Back to board</span>
        </div>
        <h1 className="font-semibold text-2xl text-text-primary">
          Settings — {board.name}
        </h1>
      </header>

      <Secrets
        boardId={id}
        onRefresh={fetchBoard}
        secrets={board.secrets ?? []}
      />
    </main>
  )
}
