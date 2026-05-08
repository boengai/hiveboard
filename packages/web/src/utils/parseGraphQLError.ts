type GraphQLErrorShape = {
  response?: {
    errors?: Array<{ message: string; extensions?: { code?: string } }>
  }
  message?: string
}

export function parseGraphQLError(
  err: unknown,
  options: {
    codeMap?: Record<string, string>
    defaultMessage?: string
  } = {},
): string {
  const e = err as GraphQLErrorShape
  const gqlErr = e.response?.errors?.[0]
  if (gqlErr) {
    const code = gqlErr.extensions?.code
    if (code && options.codeMap?.[code]) return options.codeMap[code]
    return gqlErr.message
  }
  return e.message ?? options.defaultMessage ?? 'Request failed.'
}
