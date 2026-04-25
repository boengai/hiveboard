import { useEffect, useRef } from 'react'

import { subscribe } from '@/graphql'

/**
 * Subscribe to a GraphQL SSE topic for the lifetime of the calling component.
 *
 * Wraps `subscribe` with the boilerplate every drawer tab used to repeat:
 * the `useEffect`, the `dispose` cleanup, and the dependency array. Variables
 * are stringified into a stable key so callers don't have to remember to
 * memoize the object.
 *
 * `onData` is held in a ref so a parent re-render that produces a new
 * function identity does NOT tear down and re-open the SSE iterator —
 * only `query` and the serialized `variables` cause a resubscribe.
 */
export function useTaskSubscription<TPayload>(
  query: string,
  variables: Record<string, unknown>,
  onData: (data: TPayload) => void,
): void {
  const onDataRef = useRef(onData)
  useEffect(() => {
    onDataRef.current = onData
  }, [onData])

  // Stable key so a fresh `{ taskId }` literal each render doesn't churn.
  const variablesKey = JSON.stringify(variables)

  // We intentionally exclude `variables` itself from deps — `variablesKey`
  // is the stable proxy. The eslint suppression is local to this hook.
  // biome-ignore lint/correctness/useExhaustiveDependencies: variablesKey is the stable proxy for variables
  useEffect(() => {
    const dispose = subscribe<TPayload>(query, variables, (payload) => {
      onDataRef.current(payload)
    })
    return dispose
  }, [query, variablesKey])
}
