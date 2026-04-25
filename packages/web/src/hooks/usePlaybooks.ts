import { useCallback, useEffect, useState } from 'react'
import { GET_PLAYBOOKS, graphqlClient } from '@/graphql'
import type { Playbook } from '@/types'

type UsePlaybooksResult = {
  playbooks: Playbook[]
  loading: boolean
  error: Error | null
  refresh: () => void
}

export function usePlaybooks(): UsePlaybooksResult {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await graphqlClient.request<{ playbooks: Playbook[] }>(
        GET_PLAYBOOKS,
      )
      setPlaybooks(data.playbooks)
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to load playbooks'),
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refresh = useCallback(() => {
    load()
  }, [load])

  return { error, loading, playbooks, refresh }
}
