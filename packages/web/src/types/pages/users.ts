export type ManagedUser = {
  id: string
  username: string
  displayName: string
  role: string
  githubId: string | null
  githubUsername: string | null
  revokedAt: string | null
  createdAt: string
}

export type ManagedInvitation = {
  id: string
  token: string
  githubUsername: string
  createdAt: string
  expiresAt: string
  usedAt: string | null
  createdBy: { username: string }
}
