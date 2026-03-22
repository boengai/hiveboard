import path from 'node:path'
import { createSchema, createYoga } from 'graphql-yoga'
import { loadWorkflow } from './config'
import { db, migrate } from './db'
import { Orchestrator, setOrchestrator } from './orchestrator'
import { handleImageServe, handleImageUpload } from './routes/images'
import { resolvers } from './schema/resolvers'
import { typeDefs } from './schema/typeDefs'
import { WorkspaceManager } from './workspace'
import { startCleanupInterval } from './workspace/cleanup'

const isProduction = process.env.NODE_ENV === 'production'
const staticDir = isProduction
  ? path.join(import.meta.dir, '../../web/dist')
  : null

// Run migrations on startup
migrate(db)

// Boot orchestrator (best-effort — API runs even without WORKFLOW.md)
async function startOrchestrator() {
  const workflowPath = process.env.WORKFLOW_MD ?? 'WORKFLOW.md'
  try {
    const { config, promptTemplate } = await loadWorkflow(workflowPath)
    const workspace = new WorkspaceManager(config)
    const orchestrator = new Orchestrator(config, workspace, promptTemplate)
    setOrchestrator(orchestrator)
    orchestrator.start()
  } catch (err) {
    console.warn(
      `Orchestrator not started (WORKFLOW.md not found or invalid): ${(err as Error).message}`,
    )
  }
}

startOrchestrator()

const yoga = createYoga({
  cors: {
    credentials: true,
    origin: '*',
  },
  graphqlEndpoint: '/graphql',
  maskedErrors: false,
  schema: createSchema({ resolvers, typeDefs }),
})

const port = Number(process.env.API_PORT ?? 8080)

// Start periodic cleanup of orphaned temp uploads
startCleanupInterval()

Bun.serve({
  fetch(req) {
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
    if (url.pathname.startsWith('/graphql')) {
      return yoga.fetch(req)
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
  port,
})

console.log(`API server running on http://localhost:${port}/graphql`)

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
