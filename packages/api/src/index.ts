import { createSchema, createYoga } from 'graphql-yoga'
import { typeDefs } from './schema/typeDefs'
import { resolvers } from './schema/resolvers'
import { db, migrate } from './db'
import { loadWorkflow } from './config'
import { WorkspaceManager } from './workspace'
import { Orchestrator, setOrchestrator } from './orchestrator'

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
      `Orchestrator not started (WORKFLOW.md not found or invalid): ${(err as Error).message}`
    )
  }
}

startOrchestrator()

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  graphqlEndpoint: '/graphql',
  cors: {
    origin: '*',
    credentials: true,
  },
})

const port = Number(process.env.API_PORT ?? 8080)

Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/health') {
      return Response.json({ ok: true, uptime: process.uptime() })
    }
    return yoga.fetch(req)
  },
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
