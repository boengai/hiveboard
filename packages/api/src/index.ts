import path from 'node:path'
import { setPeerIP } from './auth/peer-ip'
import { cleanExpiredSessions } from './auth/session'
import { db, migrate } from './db'
import { startOrchestrator } from './orchestrator/start'
import { handleImageServe, handleImageUpload } from './routes/images'
import { handleOAuthStart, handleOAuthCallback } from './routes/auth-oauth'
import { createApiYoga } from './schema/yoga'
import { initSecretsFromEnv } from './secrets/enabled'

const isProduction = process.env.NODE_ENV === 'production'
const staticDir = isProduction
  ? path.join(process.cwd(), 'packages/web/dist')
  : null

const webPort = Number(process.env.WEB_PORT ?? 5173)
const apiPort = Number(process.env.API_PORT ?? 8080)
const allowedOrigins = (() => {
  const env = process.env.CORS_ALLOWED_ORIGINS
  if (env) {
    return env
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  }
  if (isProduction) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS must be set in production (comma-separated list of allowed origins).',
    )
  }
  return [`http://localhost:${webPort}`, `http://localhost:${apiPort}`]
})()

// Run migrations on startup
migrate(db)

// Boot secrets feature (no-op warning if HIVEBOARD_SECRETS_KEY is unset)
initSecretsFromEnv(process.env)

// Clean expired sessions on startup and periodically (every hour)
cleanExpiredSessions()
setInterval(cleanExpiredSessions, 60 * 60 * 1000)

startOrchestrator()

const yoga = createApiYoga({ allowedOrigins, isProduction })

Bun.serve({
  async fetch(req, server) {
    const peer = server.requestIP(req)
    if (peer?.address) {
      setPeerIP(req, peer.address)
    }
    const url = new URL(req.url)
    if (url.pathname === '/health') {
      return Response.json({ ok: true, uptime: process.uptime() })
    }
    if (url.pathname === '/api/images/upload' && req.method === 'POST') {
      return handleImageUpload(req)
    }
    if (url.pathname.startsWith('/api/images/') && req.method === 'GET') {
      return handleImageServe(url.pathname)
    }
    if (url.pathname === '/api/auth/github/start' && req.method === 'GET') {
      return handleOAuthStart(req)
    }
    if (url.pathname === '/api/auth/github/callback' && req.method === 'POST') {
      return handleOAuthCallback(req)
    }
    if (url.pathname.startsWith('/graphql')) {
      const res = await yoga.fetch(req)
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('text/event-stream') || !res.body) return res

      // graphql-yoga sends SSE keepalive pings every 12 s, but clears
      // the interval when controller.desiredSize is falsy.  In Bun,
      // desiredSize can return 0 even while the connection is alive,
      // silently killing pings.  Without pings Bun's idleTimeout closes
      // the socket → ERR_INCOMPLETE_CHUNKED_ENCODING.
      //
      // Workaround: pipe yoga's response through a new ReadableStream
      // using getReader() (for-await fails on yoga's polyfilled streams
      // in Bun) and inject keepalive pings every 30 s.
      const upstream = res.body.getReader()
      const encoder = new TextEncoder()
      const ping = encoder.encode(':\n\n')
      let pingTimer: ReturnType<typeof setInterval> | null = null

      const readable = new ReadableStream({
        cancel() {
          if (pingTimer) clearInterval(pingTimer)
          upstream.cancel()
        },
        async pull(controller) {
          try {
            const { done, value } = await upstream.read()
            if (done) {
              if (pingTimer) clearInterval(pingTimer)
              controller.close()
            } else {
              controller.enqueue(value)
            }
          } catch {
            if (pingTimer) clearInterval(pingTimer)
            try {
              controller.close()
            } catch {
              // controller may already be closed
            }
          }
        },
        start(controller) {
          pingTimer = setInterval(() => {
            try {
              controller.enqueue(ping)
            } catch {
              if (pingTimer) clearInterval(pingTimer)
            }
          }, 30_000)
        },
      })

      return new Response(readable, {
        headers: res.headers,
        status: res.status,
      })
    }
    if (isProduction && staticDir) {
      const filePath = path.join(
        staticDir,
        url.pathname === '/' ? 'index.html' : url.pathname,
      )
      const file = Bun.file(filePath)
      if (file.size > 0) return new Response(file)
      // SPA fallback
      return new Response(Bun.file(path.join(staticDir, 'index.html')))
    }
    return yoga.fetch(req)
  },
  // SSE subscriptions are long-lived connections that may be idle for extended
  // periods.  Bun's default 10 s idle timeout closes them prematurely, causing
  // the client to enter an endless reconnect loop.  255 s is the maximum value
  // Bun allows; the graphql-sse client will reconnect if the connection drops.
  idleTimeout: 255,
  port: apiPort,
})

console.log(`API server running on http://localhost:${apiPort}/graphql`)

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...')
  const { getOrchestrator } = await import('./orchestrator')
  const orchestrator = getOrchestrator()
  if (orchestrator) await orchestrator.shutdown()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down...')
  const { getOrchestrator } = await import('./orchestrator')
  const orchestrator = getOrchestrator()
  if (orchestrator) await orchestrator.shutdown()
  process.exit(0)
})
