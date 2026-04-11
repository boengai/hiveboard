import path from 'node:path'
import {
  type DocumentNode,
  GraphQLError,
  type GraphQLNamedType,
  type GraphQLSchema,
  getNamedType,
  isIntrospectionType,
  type ValidationRule,
  validate,
} from 'graphql'
import { createSchema, createYoga } from 'graphql-yoga'
import { getAuthContext, handleInvitationOAuth, handleLoginOAuth } from './auth'
import { loadWorkflow } from './config'
import { db, migrate } from './db'
import { GitHubClient } from './github/client'
import { Orchestrator, setOrchestrator } from './orchestrator'
import { useMutationRateLimit } from './rate-limit'
import { handleImageServe, handleImageUpload } from './routes/images'
import { resolvers } from './schema/resolvers'
import { typeDefs } from './schema/typeDefs'
import { WorkspaceManager } from './workspace'
import { startCleanupInterval } from './workspace/cleanup'

const isProduction = process.env.NODE_ENV === 'production'
const staticDir = isProduction
  ? path.join(process.cwd(), 'packages/web/dist')
  : null

// Run migrations on startup
migrate(db)

// Boot orchestrator (best-effort — API runs even without WORKFLOW.md)
async function startOrchestrator() {
  try {
    const { config, promptTemplate } = await loadWorkflow()
    const github = GitHubClient.create()
    // Generate initial token so process.env.GITHUB_TOKEN is set
    // before any agent spawns (gh/git need it immediately)
    await github.getAccessToken()
    const workspace = new WorkspaceManager(config)
    const orchestrator = new Orchestrator(
      config,
      github,
      workspace,
      promptTemplate,
    )
    setOrchestrator(orchestrator)
    orchestrator.start()
  } catch (err) {
    console.warn(
      `Orchestrator not started (WORKFLOW.md not found or invalid): ${(err as Error).message}`,
    )
  }
}

startOrchestrator()

const defaultQuery = /* GraphQL */ `# Welcome to HiveBoard GraphQL API
#
# Example queries to get started:

# List all boards
query ListBoards {
  boards {
    id
    name
    createdAt
    columns {
      id
      name
      position
      tasks {
        id
        title
        agentStatus
      }
    }
  }
}

# Get a single board by ID
# query GetBoard {
#   board(id: "YOUR_BOARD_ID") {
#     id
#     name
#     columns {
#       id
#       name
#       tasks {
#         id
#         title
#         body
#         agentStatus
#         prUrl
#         tags { id name color }
#         createdBy { username displayName }
#         createdAt
#         updatedAt
#       }
#     }
#   }
# }

# Get task details with comments and timeline
# query GetTask {
#   task(id: "YOUR_TASK_ID") {
#     id
#     title
#     body
#     agentStatus
#     prUrl
#     column { name }
#     tags { name color }
#     comments {
#       id
#       body
#       createdBy { username }
#       createdAt
#     }
#   }
# }

# Create a new board
# mutation CreateBoard {
#   createBoard(name: "My Board") {
#     id
#     name
#   }
# }

# Create a task
# mutation CreateTask {
#   createTask(input: {
#     boardId: "YOUR_BOARD_ID"
#     title: "Implement feature X"
#     body: "Description of the task"
#   }) {
#     id
#     title
#     column { name }
#   }
# }
`

const yoga = createYoga({
  context({ request }: { request: Request }) {
    return { ...getAuthContext(request), request }
  },
  // CORS: credentials requires a specific origin, not '*'.
  // Dynamically reflect the request's Origin header so credentialed
  // requests receive a valid Access-Control-Allow-Origin value.
  // To restrict access, set CORS_ALLOWED_ORIGINS as a comma-separated
  // list of allowed origins (e.g. "https://app.example.com,http://localhost:3000").
  cors(req) {
    const allowedEnv = process.env.CORS_ALLOWED_ORIGINS
    const allowedOrigins = allowedEnv
      ? allowedEnv.split(',').map((o) => o.trim())
      : null
    const requestOrigin = req.headers.get('origin')

    if (allowedOrigins) {
      // Whitelist mode: only reflect origins that are explicitly allowed
      const origin =
        requestOrigin && allowedOrigins.includes(requestOrigin)
          ? requestOrigin
          : allowedOrigins[0]
      return { credentials: true, origin }
    }

    // Development / open mode: reflect the request origin so credentials work,
    // or fall back to '*' for non-credentialed requests without an Origin header.
    return { credentials: true, origin: requestOrigin ?? '*' }
  },
  graphiql: isProduction ? false : { defaultQuery, title: 'HiveBoard GraphQL' },
  graphqlEndpoint: '/graphql',
  maskedErrors: false,
  plugins: [
    ...(isProduction
      ? [
          {
            onValidate({
              params,
              setResult,
            }: {
              params: {
                schema: GraphQLSchema
                documentAST: DocumentNode
                rules?: readonly ValidationRule[]
              }
              setResult: (errors: readonly GraphQLError[]) => void
            }) {
              const noIntrospection: ValidationRule = (ctx) => ({
                Field(node) {
                  const type: GraphQLNamedType | undefined = getNamedType(
                    ctx.getType(),
                  )
                  if (type && isIntrospectionType(type)) {
                    ctx.reportError(
                      new GraphQLError(
                        `GraphQL introspection has been disabled, but the requested query contained the field "${node.name.value}".`,
                        { nodes: node },
                      ),
                    )
                  }
                },
              })
              const rules = [...(params.rules ?? []), noIntrospection]
              const errors = validate(params.schema, params.documentAST, rules)
              if (errors.length > 0) {
                setResult(errors)
              }
            },
          },
        ]
      : []),
    useMutationRateLimit(),
  ],
  schema: createSchema({ resolvers, typeDefs }),
})

const port = Number(process.env.API_PORT ?? 8080)

async function handleOAuthCallback(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      code?: string
      invitationToken?: string
    }
    if (!body.code) {
      return Response.json({ error: 'Missing code parameter' }, { status: 400 })
    }

    const result = body.invitationToken
      ? await handleInvitationOAuth(body.code, body.invitationToken)
      : await handleLoginOAuth(body.code)

    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OAuth callback failed'
    return Response.json({ error: message }, { status: 400 })
  }
}

// Start periodic cleanup of orphaned temp uploads
startCleanupInterval()

Bun.serve({
  async fetch(req) {
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
