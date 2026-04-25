import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { ArrowIcon, Button, TextInput } from '@/components'
import {
  GENERATE_INVITATION,
  GET_INVITATIONS,
  GET_USERS,
  graphqlClient,
  REVOKE_USER,
} from '@/graphql'
import { useAuthStore } from '@/store/authStore'
import type { ManagedInvitation, ManagedUser } from '@/types'

export function UsersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [invitations, setInvitations] = useState<ManagedInvitation[]>([])
  const [newGithubUsername, setNewGithubUsername] = useState('')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const [usersData, invitationsData] = await Promise.all([
        graphqlClient.request<{ users: ManagedUser[] }>(GET_USERS),
        graphqlClient.request<{ invitations: ManagedInvitation[] }>(
          GET_INVITATIONS,
        ),
      ])
      setUsers(usersData.users)
      setInvitations(invitationsData.invitations)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  if (currentUser?.role !== 'super-admin') {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-text-danger">Access denied. Super-admin only.</p>
      </div>
    )
  }

  const handleGenerateInvitation = async () => {
    if (!newGithubUsername.trim()) return
    setError(null)
    setInviteLink(null)

    try {
      const data = await graphqlClient.request<{
        generateInvitation: { token: string }
      }>(GENERATE_INVITATION, { githubUsername: newGithubUsername.trim() })

      const link = `${window.location.origin}/login?invitation=${data.generateInvitation.token}`
      setInviteLink(link)
      setNewGithubUsername('')
      loadData()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate invitation',
      )
    }
  }

  const handleRevokeUser = async (userId: string) => {
    setError(null)
    try {
      await graphqlClient.request(REVOKE_USER, { userId })
      loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke user')
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-text-secondary">Loading...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div className="flex items-center gap-1">
        <Link className="text-body-sm text-honey-400 hover:underline" to="/">
          <ArrowIcon />
        </Link>
        <h1 className="font-semibold text-lg text-text-primary">
          User Management
        </h1>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-body-sm text-red-700">
          {error}
        </div>
      )}

      {/* Generate Invitation */}
      <section className="space-y-3">
        <h2 className="font-medium text-body-sm text-text-primary">
          Generate Invitation
        </h2>
        <div className="flex gap-2">
          <div className="flex-1">
            <TextInput
              onChange={setNewGithubUsername}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleGenerateInvitation()
              }}
              placeholder="GitHub username"
              type="text"
              value={newGithubUsername}
            />
          </div>
          <Button onClick={handleGenerateInvitation}>Generate</Button>
        </div>
        {inviteLink && (
          <div className="space-y-1 rounded-lg border border-honey-200 bg-honey-50 p-3">
            <p className="text-body-xs text-text-secondary">
              Invitation link (single-use, expires in 7 days):
            </p>
            <code className="block break-all text-body-xs text-text-primary">
              {inviteLink}
            </code>
            <Button
              color="primary"
              onClick={() => navigator.clipboard.writeText(inviteLink)}
              size="small"
              type="button"
              variant="link"
            >
              Copy to clipboard
            </Button>
          </div>
        )}
      </section>

      {/* Users List */}
      <section className="space-y-3">
        <h2 className="font-medium text-body-sm text-text-primary">
          Users ({users.length})
        </h2>
        <div className="overflow-hidden rounded-lg border border-border-default">
          <table className="w-full">
            <thead className="bg-surface-raised">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-body-xs text-text-secondary">
                  Username
                </th>
                <th className="px-4 py-2 text-left font-medium text-body-xs text-text-secondary">
                  GitHub
                </th>
                <th className="px-4 py-2 text-left font-medium text-body-xs text-text-secondary">
                  Role
                </th>
                <th className="px-4 py-2 text-left font-medium text-body-xs text-text-secondary">
                  Joined
                </th>
                <th className="px-4 py-2 text-left font-medium text-body-xs text-text-secondary">
                  Status
                </th>
                <th className="px-4 py-2 text-right font-medium text-body-xs text-text-secondary">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2 text-body-sm text-text-primary">
                    {u.displayName}
                  </td>
                  <td className="px-4 py-2 text-body-sm text-text-secondary">
                    @{u.githubUsername ?? u.username}
                  </td>
                  <td className="px-4 py-2 text-body-sm text-text-secondary">
                    {u.role}
                  </td>
                  <td className="px-4 py-2 text-body-sm text-text-secondary">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-body-sm">
                    {u.revokedAt ? (
                      <span className="text-red-500">Revoked</span>
                    ) : (
                      <span className="text-green-500">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {u.username !== 'queen-bee' && !u.revokedAt && (
                      <Button
                        color="danger"
                        onClick={() => handleRevokeUser(u.id)}
                        size="small"
                        type="button"
                        variant="link"
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Invitations List */}
      <section className="space-y-3">
        <h2 className="font-medium text-body-sm text-text-primary">
          Invitations ({invitations.length})
        </h2>
        {invitations.length === 0 ? (
          <p className="text-body-sm text-text-secondary">
            No invitations yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border-default">
            <table className="w-full">
              <thead className="bg-surface-raised">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-body-xs text-text-secondary">
                    GitHub Username
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-body-xs text-text-secondary">
                    Created
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-body-xs text-text-secondary">
                    Expires
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-body-xs text-text-secondary">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {invitations.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-4 py-2 text-body-sm text-text-primary">
                      @{inv.githubUsername}
                    </td>
                    <td className="px-4 py-2 text-body-sm text-text-secondary">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-body-sm text-text-secondary">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-body-sm">
                      {inv.usedAt ? (
                        <span className="text-green-500">Used</span>
                      ) : new Date(inv.expiresAt) < new Date() ? (
                        <span className="text-text-secondary">Expired</span>
                      ) : (
                        <span className="text-honey-400">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
