import { type DefinitionNode, GraphQLError, Kind } from 'graphql'
import type { Plugin } from 'graphql-yoga'

/**
 * Rate Limiting Configuration
 *
 * All GraphQL mutations are rate-limited per client IP:
 *   - 60 mutations per 60-second sliding window
 *   - Applies to: createTask, updateTask, moveTask, archiveTask,
 *     unarchiveTask, createBoard, addComment, updateComment,
 *     deleteComment, createTag, deleteTag, setTaskTags, cancelAgent
 *   - Queries and subscriptions are NOT rate-limited
 *   - IP is extracted from x-forwarded-for, x-real-ip headers,
 *     or defaults to "unknown"
 *
 * When the limit is exceeded, the server returns a GraphQL error
 * with code RATE_LIMITED.
 */

const WINDOW_MS = 60_000
const MAX_MUTATIONS_PER_WINDOW = 60

/** Sliding-window rate limiter backed by an in-memory Map. */
export class RateLimiter {
  private windows = new Map<string, number[]>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  readonly windowMs: number
  readonly max: number

  constructor(
    opts: { windowMs?: number; max?: number } = {},
  ) {
    this.windowMs = opts.windowMs ?? WINDOW_MS
    this.max = opts.max ?? MAX_MUTATIONS_PER_WINDOW
  }

  /** Check and record a request. Returns whether it's allowed. */
  check(key: string): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const now = Date.now()
    const cutoff = now - this.windowMs
    const timestamps = this.windows.get(key) ?? []
    const valid = timestamps.filter(t => t > cutoff)

    if (valid.length >= this.max) {
      this.windows.set(key, valid)
      const oldest = valid[0] as number
      const retryAfterMs = oldest + this.windowMs - now
      return { allowed: false, remaining: 0, retryAfterMs }
    }

    valid.push(now)
    this.windows.set(key, valid)
    return { allowed: true, remaining: this.max - valid.length, retryAfterMs: 0 }
  }

  /** Remove expired entries to prevent unbounded memory growth. */
  cleanup(): void {
    const cutoff = Date.now() - this.windowMs
    for (const [key, timestamps] of this.windows) {
      const valid = timestamps.filter(t => t > cutoff)
      if (valid.length === 0) this.windows.delete(key)
      else this.windows.set(key, valid)
    }
  }

  /** Start periodic cleanup (every windowMs). */
  startCleanup(): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => this.cleanup(), this.windowMs)
    // Allow the process to exit even if the timer is still running
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref()
    }
  }

  /** Stop periodic cleanup. */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /** Number of tracked keys (for testing/monitoring). */
  get size(): number {
    return this.windows.size
  }

  /** Reset all state (for testing). */
  reset(): void {
    this.windows.clear()
  }
}

/** Extract client IP from request headers. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? forwarded.trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

/** Shared rate limiter instance for mutation operations. */
export const mutationRateLimiter = new RateLimiter()

/**
 * graphql-yoga plugin that rate-limits mutation operations per client IP.
 * Queries and subscriptions pass through unrestricted.
 */
export function useMutationRateLimit(limiter: RateLimiter = mutationRateLimiter): Plugin {
  limiter.startCleanup()

  return {
    onExecute({ args }) {
      const operation = args.document.definitions.find(
        (def: DefinitionNode) => def.kind === Kind.OPERATION_DEFINITION,
      )
      if (
        !operation ||
        operation.kind !== Kind.OPERATION_DEFINITION ||
        operation.operation !== 'mutation'
      ) return

      const request = (args.contextValue as { request?: Request }).request
      const ip = request ? getClientIp(request) : 'unknown'
      const result = limiter.check(ip)

      if (!result.allowed) {
        const retryAfterSec = Math.ceil(result.retryAfterMs / 1000)
        throw new GraphQLError(
          `Rate limit exceeded. Try again in ${retryAfterSec}s.`,
          {
            extensions: {
              code: 'RATE_LIMITED',
              retryAfter: retryAfterSec,
            },
          },
        )
      }
    },
  }
}
