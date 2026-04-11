import { db, generateId } from '../db'
import { consumeInvitation, validateInvitation } from './invitation'
import { createSession } from './session'

type GitHubUser = {
  id: number
  login: string
  name: string | null
  avatar_url: string
}

/**
 * Exchange a GitHub OAuth authorization code for an access token,
 * then fetch the user's GitHub profile.
 */
export async function exchangeCodeForUser(code: string): Promise<GitHubUser> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error(
      'GitHub OAuth not configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.',
    )
  }

  // Exchange code for access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  const tokenData = (await tokenRes.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }

  if (tokenData.error || !tokenData.access_token) {
    throw new Error(
      `GitHub OAuth error: ${tokenData.error_description ?? tokenData.error ?? 'unknown'}`,
    )
  }

  // Fetch user profile
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${tokenData.access_token}`,
      'User-Agent': 'HiveBoard',
    },
  })

  if (!userRes.ok) {
    throw new Error(`Failed to fetch GitHub user: ${userRes.statusText}`)
  }

  return (await userRes.json()) as GitHubUser
}

type UserRow = {
  id: string
  username: string
  display_name: string
  role: string
  github_id: string | null
  github_username: string | null
  revoked_at: string | null
}

/**
 * Handle the OAuth callback for invitation-based sign-up.
 * Validates the invitation, verifies the GitHub username matches,
 * creates the user account, and returns a session token.
 */
export async function handleInvitationOAuth(
  code: string,
  invitationToken: string,
): Promise<{ sessionToken: string; user: { username: string; role: string } }> {
  const invitation = validateInvitation(invitationToken)
  if (!invitation) {
    throw new Error('Invalid or expired invitation')
  }

  const githubUser = await exchangeCodeForUser(code)

  // Validate that the GitHub username matches the invitation
  if (
    githubUser.login.toLowerCase() !== invitation.github_username.toLowerCase()
  ) {
    throw new Error(
      `This invitation was for @${invitation.github_username} but you authenticated as @${githubUser.login}`,
    )
  }

  const githubId = String(githubUser.id)

  // Check if user already exists (re-join flow)
  const existingUser = db
    .query('SELECT * FROM users WHERE github_id = ?')
    .get(githubId) as UserRow | null

  let userId: string

  if (existingUser) {
    // Re-activate revoked user
    userId = existingUser.id
    db.run(
      "UPDATE users SET revoked_at = NULL, github_username = ?, display_name = ?, role = 'normal' WHERE id = ?",
      [githubUser.login, githubUser.name ?? githubUser.login, userId],
    )
  } else {
    // Create new user
    userId = generateId()
    db.run(
      "INSERT INTO users (id, username, display_name, role, github_id, github_username) VALUES (?, ?, ?, 'normal', ?, ?)",
      [
        userId,
        githubUser.login,
        githubUser.name ?? githubUser.login,
        githubId,
        githubUser.login,
      ],
    )
  }

  // Mark invitation as used
  consumeInvitation(invitationToken, githubId)

  // Create session
  const session = createSession(userId)

  return {
    sessionToken: session.token,
    user: {
      role: 'normal',
      username: githubUser.login,
    },
  }
}

/**
 * Handle OAuth callback for returning users (already have an account).
 */
export async function handleLoginOAuth(
  code: string,
): Promise<{ sessionToken: string; user: { username: string; role: string } }> {
  const githubUser = await exchangeCodeForUser(code)
  const githubId = String(githubUser.id)

  const existingUser = db
    .query('SELECT * FROM users WHERE github_id = ?')
    .get(githubId) as UserRow | null

  if (!existingUser) {
    throw new Error(
      'No account found. You need an invitation to access HiveBoard.',
    )
  }

  if (existingUser.revoked_at) {
    throw new Error(
      'Your access has been revoked. Contact the administrator for a new invitation.',
    )
  }

  // Update github_username in case it changed
  db.run('UPDATE users SET github_username = ? WHERE id = ?', [
    githubUser.login,
    existingUser.id,
  ])

  const session = createSession(existingUser.id)

  return {
    sessionToken: session.token,
    user: {
      role: existingUser.role,
      username: existingUser.username,
    },
  }
}
