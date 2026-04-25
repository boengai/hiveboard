import { describe, expect, it } from 'bun:test'

import { buildPromptContext } from '../src/agent/prompt-context'
import type { TaskForPrompt } from '../src/agent/prompt'

const TASK: TaskForPrompt = {
  action: 'implement',
  agentInstruction: 'be careful',
  body: 'Body of task',
  id: '01HYX3KPQR000000000000000A',
  prUrl: null,
  targetBranch: 'main',
  targetRepo: 'acme/webapp',
  title: 'Add OAuth flow',
}

describe('buildPromptContext', () => {
  it('produces all expected top-level keys with sensible defaults', () => {
    const ctx = buildPromptContext({ task: TASK })
    // The presence of these keys is the contract both rendering paths
    // (WORKFLOW.md and playbooks) depend on. If a key disappears, both
    // paths' templates silently fail their `{{#has_x}}` guards.
    expect(Object.keys(ctx).sort()).toEqual(
      [
        'attempt',
        'auto_revise_from_verification',
        'has_messages',
        'has_required_secrets',
        'has_review_comments',
        'messages',
        'previous_attempt_replay',
        'required_secrets_list',
        'review_comments',
        'scratchpad',
        'task',
        'verification_failures',
      ].sort(),
    )
  })

  it('splits targetRepo into repo_owner / repo_name', () => {
    const ctx = buildPromptContext({ task: TASK })
    expect(ctx.task.repo_owner).toBe('acme')
    expect(ctx.task.repo_name).toBe('webapp')
  })

  it('sets has_messages / has_review_comments / has_required_secrets correctly', () => {
    const empty = buildPromptContext({ task: TASK })
    expect(empty.has_messages).toBe(false)
    expect(empty.has_review_comments).toBe(false)
    expect(empty.has_required_secrets).toBe(false)

    const full = buildPromptContext({
      messages: [{ body: 'hi', created_at: 'now', kind: 'hint' }],
      requiredSecrets: [{ description: null, name: 'OPENAI_KEY' }],
      reviewComments: 'some review',
      task: TASK,
    })
    expect(full.has_messages).toBe(true)
    expect(full.has_review_comments).toBe(true)
    expect(full.has_required_secrets).toBe(true)
  })

  it('flips auto_revise_from_verification when verificationFailures is non-empty', () => {
    const off = buildPromptContext({ task: TASK })
    expect(off.auto_revise_from_verification).toBe(false)

    const on = buildPromptContext({
      task: TASK,
      verificationFailures: [
        { command: 'tsc', exit_code: 1, label: 'tsc', output: 'err' },
      ],
    })
    expect(on.auto_revise_from_verification).toBe(true)
  })

  it('defaults targetBranch to main and prUrl to empty string', () => {
    const ctx = buildPromptContext({
      task: { ...TASK, prUrl: null, targetBranch: null },
    })
    expect(ctx.task.target_branch).toBe('main')
    expect(ctx.task.pr_url).toBe('')
  })
})
