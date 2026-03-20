import { createSchema, createYoga } from 'graphql-yoga'
import { typeDefs } from './schema/typeDefs'
import { resolvers } from './schema/resolvers'
import { db, migrate } from './db'

// Run migrations on startup
migrate(db)

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
