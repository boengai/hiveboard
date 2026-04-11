import { describe, expect, test } from 'bun:test'
import {
  type DocumentNode,
  GraphQLError as GQLError,
  type GraphQLError,
  type GraphQLNamedType,
  type GraphQLSchema,
  getNamedType,
  isIntrospectionType,
  type ValidationContext,
  type ValidationRule,
  validate,
} from 'graphql'
import { createSchema, createYoga } from 'graphql-yoga'
import { resolvers } from '../src/schema/resolvers'
import { typeDefs } from '../src/schema/typeDefs'

// ---------------------------------------------------------------------------
// Helper — create a yoga instance with or without introspection blocking
// ---------------------------------------------------------------------------

/** Inline introspection-blocking rule (avoids graphql CJS/ESM dual-package hazard). */
const noIntrospectionRule: ValidationRule = (ctx: ValidationContext) => ({
  Field(node) {
    const type: GraphQLNamedType | undefined = getNamedType(ctx.getType())
    if (type && isIntrospectionType(type)) {
      ctx.reportError(
        new GQLError(
          `GraphQL introspection has been disabled, but the requested query contained the field "${node.name.value}".`,
          { nodes: node },
        ),
      )
    }
  },
})

function createTestYoga(production: boolean) {
  return createYoga({
    plugins: production
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
              const rules = [...(params.rules ?? []), noIntrospectionRule]
              const errors = validate(params.schema, params.documentAST, rules)
              if (errors.length > 0) {
                setResult(errors)
              }
            },
          },
        ]
      : [],
    schema: createSchema({ resolvers, typeDefs }),
  })
}

const INTROSPECTION_QUERY = JSON.stringify({
  query: '{ __schema { types { name } } }',
})

async function fetchGraphQL(yoga: ReturnType<typeof createYoga>, body: string) {
  return yoga.fetch('http://localhost/graphql', {
    body,
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphQL introspection', () => {
  test('blocks introspection in production mode', async () => {
    const yoga = createTestYoga(true)
    const res = await fetchGraphQL(yoga, INTROSPECTION_QUERY)
    const json = (await res.json()) as { errors?: { message: string }[] }

    expect(res.status).toBe(200)
    expect(json.errors).toBeDefined()
    expect(json.errors?.length).toBeGreaterThan(0)
    expect(json.errors?.[0].message).toContain('introspection')
  })

  test('allows introspection in development mode', async () => {
    const yoga = createTestYoga(false)
    const res = await fetchGraphQL(yoga, INTROSPECTION_QUERY)
    const json = (await res.json()) as {
      data?: { __schema: { types: { name: string }[] } }
    }

    expect(res.status).toBe(200)
    expect(json.data).toBeDefined()
    expect(json.data?.__schema.types.length).toBeGreaterThan(0)
  })
})
