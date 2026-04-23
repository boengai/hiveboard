import { GraphQLError } from 'graphql'
import Mustache from 'mustache'
import { z } from 'zod/v4'

export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a valid hex color (e.g. #e53e3e)')

/**
 * GitHub `owner/repo` — owner and repo each limited to the characters GitHub
 * itself allows (alphanumeric, hyphen, underscore, dot). Anything outside this
 * set would be rejected by GitHub anyway but could be passed through to the
 * workspace hook shell script, so we reject it at the input boundary.
 */
const TARGET_REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

/**
 * Branch names follow git's ref-name rules loosely — we accept the safe
 * subset: letters, digits, `_`, `-`, `.`, `/`. No whitespace or shell
 * metacharacters. Rejects leading/trailing dots and slashes and empty segments.
 */
const TARGET_BRANCH_RE = /^[A-Za-z0-9_.\-/]+$/

export function validateTargetRepo(value: string | null | undefined): void {
  if (value === null || value === undefined || value === '') return
  if (!TARGET_REPO_RE.test(value)) {
    throw new GraphQLError(
      `Invalid targetRepo "${value}". Expected "owner/repo" with only letters, digits, dots, hyphens, or underscores.`,
      { extensions: { code: 'BAD_USER_INPUT' } },
    )
  }
}

export function validateTargetBranch(value: string | null | undefined): void {
  if (value === null || value === undefined || value === '') return
  if (
    !TARGET_BRANCH_RE.test(value) ||
    value.startsWith('/') ||
    value.startsWith('.') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.includes('//') ||
    value.includes('..')
  ) {
    throw new GraphQLError(
      `Invalid targetBranch "${value}". Branch names may contain letters, digits, '_', '-', '.', and '/', with no leading/trailing '/' or '.'.`,
      { extensions: { code: 'BAD_USER_INPUT' } },
    )
  }
}

// ---------------------------------------------------------------------------
// Playbook validation
// ---------------------------------------------------------------------------

export const PLAYBOOK_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const VALID_TOOL_NAMES = new Set([
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
])

export type PlaybookInput = {
  name: string
  displayName: string
  description: string
  promptTemplate: string
  defaultsJson: string
  allowedToolsOverride: string[] | null
}

/**
 * Validate a playbook create/update payload. Name regex, reserved prefix,
 * template Mustache syntax, defaults JSON shape, and tool allowlist.
 */
export function validatePlaybookInput(input: PlaybookInput): void {
  if (!PLAYBOOK_NAME_REGEX.test(input.name)) {
    throw new Error(
      `Playbook name must match /^[a-z0-9]+(-[a-z0-9]+)*$/: got "${input.name}"`,
    )
  }
  if (input.name.startsWith('playbook:')) {
    throw new Error(
      `Playbook name must not start with the reserved prefix "playbook:"`,
    )
  }
  try {
    Mustache.parse(input.promptTemplate)
  } catch (e) {
    throw new Error(`Invalid Mustache template: ${(e as Error).message}`)
  }
  try {
    const parsed = JSON.parse(input.defaultsJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('defaultsJson must parse to a JSON object')
    }
  } catch (e) {
    throw new Error(`Invalid defaultsJson: ${(e as Error).message}`)
  }
  if (input.allowedToolsOverride) {
    for (const tool of input.allowedToolsOverride) {
      if (!VALID_TOOL_NAMES.has(tool)) {
        throw new Error(`Unknown tool in allowedToolsOverride: ${tool}`)
      }
    }
  }
}
