import { GraphQLClient } from 'graphql-request'

export const graphqlClient = new GraphQLClient(
  `${window.location.origin}/graphql`,
)
