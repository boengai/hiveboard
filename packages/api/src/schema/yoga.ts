import { useGraphQLSSE } from '@graphql-yoga/plugin-graphql-sse'
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
import { getAuthContext } from '../auth'
import { useMutationRateLimit } from '../rate-limit'
import { resolvers } from './resolvers'
import { typeDefs } from './typeDefs'

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

export function createApiYoga(deps: {
  allowedOrigins: string[]
  isProduction: boolean
}) {
  const { allowedOrigins, isProduction } = deps
  return createYoga({
    context({ request }: { request: Request }) {
      return { ...getAuthContext(request), request }
    },
    // CORS: credentials require a specific origin, never a reflected one.
    // Allowed origins come from CORS_ALLOWED_ORIGINS (comma-separated).
    // If unset:
    //   - in production, startup fails fast below
    //   - in development, we fall back to a strict localhost-only default
    // so a malicious site cannot get credentialed responses by setting Origin.
    cors(req) {
      const requestOrigin = req.headers.get('origin')
      const origin =
        requestOrigin && allowedOrigins.includes(requestOrigin)
          ? requestOrigin
          : allowedOrigins[0]
      return { credentials: true, origin }
    },
    graphiql: isProduction
      ? false
      : { defaultQuery, title: 'HiveBoard GraphQL' },
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
      // Adds graphql-sse single-connection protocol support (PUT to reserve,
      // GET to stream, POST to subscribe). Without this plugin yoga only
      // serves the per-subscription distinct mode, which the client used to
      // hit the browser's HTTP/1.1 6-conn-per-host limit when a task drawer
      // was open.
      useGraphQLSSE(),
    ],
    schema: createSchema({ resolvers, typeDefs }),
  })
}
