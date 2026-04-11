import { beforeEach, describe, expect, test } from 'bun:test'
import { createSchema, createYoga } from 'graphql-yoga'
import { RateLimiter, getClientIp, useMutationRateLimit } from '../src/rate-limit'

// ---------------------------------------------------------------------------
// RateLimiter unit tests
// ---------------------------------------------------------------------------

describe('RateLimiter', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    limiter = new RateLimiter({ windowMs: 1000, max: 3 })
  })

  test('allows requests under the limit', () => {
    expect(limiter.check('ip1').allowed).toBe(true)
    expect(limiter.check('ip1').allowed).toBe(true)
    expect(limiter.check('ip1').allowed).toBe(true)
  })

  test('blocks requests over the limit', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    const result = limiter.check('ip1')
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  test('tracks remaining correctly', () => {
    expect(limiter.check('ip1').remaining).toBe(2)
    expect(limiter.check('ip1').remaining).toBe(1)
    expect(limiter.check('ip1').remaining).toBe(0)
  })

  test('different keys are independent', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    expect(limiter.check('ip1').allowed).toBe(false)
    expect(limiter.check('ip2').allowed).toBe(true)
  })

  test('cleanup removes expired entries', async () => {
    const shortLimiter = new RateLimiter({ windowMs: 50, max: 3 })
    shortLimiter.check('ip1')
    expect(shortLimiter.size).toBe(1)

    await new Promise(resolve => setTimeout(resolve, 60))
    shortLimiter.cleanup()
    expect(shortLimiter.size).toBe(0)
  })

  test('requests are allowed again after window expires', async () => {
    const shortLimiter = new RateLimiter({ windowMs: 50, max: 2 })
    shortLimiter.check('ip1')
    shortLimiter.check('ip1')
    expect(shortLimiter.check('ip1').allowed).toBe(false)

    await new Promise(resolve => setTimeout(resolve, 60))
    expect(shortLimiter.check('ip1').allowed).toBe(true)
  })

  test('reset clears all state', () => {
    limiter.check('ip1')
    limiter.check('ip2')
    expect(limiter.size).toBe(2)
    limiter.reset()
    expect(limiter.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getClientIp
// ---------------------------------------------------------------------------

describe('getClientIp', () => {
  test('extracts IP from x-forwarded-for', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    })
    expect(getClientIp(req)).toBe('1.2.3.4')
  })

  test('extracts IP from x-real-ip', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-real-ip': '10.0.0.1' },
    })
    expect(getClientIp(req)).toBe('10.0.0.1')
  })

  test('falls back to unknown', () => {
    const req = new Request('http://localhost')
    expect(getClientIp(req)).toBe('unknown')
  })

  test('prefers x-forwarded-for over x-real-ip', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '10.0.0.1' },
    })
    expect(getClientIp(req)).toBe('1.2.3.4')
  })
})

// ---------------------------------------------------------------------------
// Yoga plugin integration
// ---------------------------------------------------------------------------

const typeDefs = /* GraphQL */ `
  type Query {
    hello: String!
  }
  type Mutation {
    doSomething(input: String!): String!
  }
`

const resolvers = {
  Query: {
    hello: () => 'world',
  },
  Mutation: {
    doSomething: (_: unknown, args: { input: string }) => args.input,
  },
}

function createTestYoga(limiter: RateLimiter) {
  return createYoga({
    schema: createSchema({ typeDefs, resolvers }),
    plugins: [useMutationRateLimit(limiter)],
  })
}

async function executeQuery(
  yoga: ReturnType<typeof createYoga>,
  query: string,
  ip = '127.0.0.1',
) {
  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({ query }),
  })
  return response.json() as Promise<{ data?: unknown; errors?: Array<{ message: string; extensions?: { code?: string; retryAfter?: number } }> }>
}

describe('useMutationRateLimit plugin', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    limiter = new RateLimiter({ windowMs: 60_000, max: 3 })
  })

  test('allows mutations under the limit', async () => {
    const yoga = createTestYoga(limiter)
    const result = await executeQuery(yoga, 'mutation { doSomething(input: "a") }')
    expect(result.errors).toBeUndefined()
    expect(result.data).toEqual({ doSomething: 'a' })
  })

  test('blocks mutations over the limit', async () => {
    const yoga = createTestYoga(limiter)
    const mutation = 'mutation { doSomething(input: "a") }'

    await executeQuery(yoga, mutation)
    await executeQuery(yoga, mutation)
    await executeQuery(yoga, mutation)
    const result = await executeQuery(yoga, mutation)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].extensions?.code).toBe('RATE_LIMITED')
    expect(result.errors[0].message).toContain('Rate limit exceeded')
  })

  test('does not rate limit queries', async () => {
    const yoga = createTestYoga(limiter)
    const query = '{ hello }'

    // Exhaust the mutation limit
    const mutation = 'mutation { doSomething(input: "a") }'
    await executeQuery(yoga, mutation)
    await executeQuery(yoga, mutation)
    await executeQuery(yoga, mutation)

    // Queries should still work
    const result = await executeQuery(yoga, query)
    expect(result.errors).toBeUndefined()
    expect(result.data).toEqual({ hello: 'world' })
  })

  test('rate limits are per-IP', async () => {
    const yoga = createTestYoga(limiter)
    const mutation = 'mutation { doSomething(input: "a") }'

    // Exhaust limit for IP 1
    await executeQuery(yoga, mutation, '10.0.0.1')
    await executeQuery(yoga, mutation, '10.0.0.1')
    await executeQuery(yoga, mutation, '10.0.0.1')
    expect((await executeQuery(yoga, mutation, '10.0.0.1')).errors).toHaveLength(1)

    // IP 2 should still work
    const result = await executeQuery(yoga, mutation, '10.0.0.2')
    expect(result.errors).toBeUndefined()
  })

  test('error includes retryAfter', async () => {
    const yoga = createTestYoga(limiter)
    const mutation = 'mutation { doSomething(input: "a") }'

    await executeQuery(yoga, mutation)
    await executeQuery(yoga, mutation)
    await executeQuery(yoga, mutation)
    const result = await executeQuery(yoga, mutation)

    expect(result.errors[0].extensions?.retryAfter).toBeGreaterThan(0)
  })
})
