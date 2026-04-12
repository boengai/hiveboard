import { GraphQLClient } from 'graphql-request'

const STORAGE_KEY = 'hiveboard_access_token'

export const graphqlClient = new GraphQLClient(
  `${window.location.origin}/graphql`,
  {
    requestMiddleware(request) {
      const token = localStorage.getItem(STORAGE_KEY)
      if (token) {
        return {
          ...request,
          headers: {
            ...request.headers,
            Authorization: `Bearer ${token}`,
          },
        }
      }
      return request
    },
  },
)
