import { describe, expect, it } from 'bun:test'
import type { TaskForPrompt } from '../src/agent/prompt'
import { renderPrompt } from '../src/agent/prompt'

const TASK: TaskForPrompt = {
  action: 'implement',
  agentInstruction: null,
  body: 'body',
  id: 'task-1',
  prUrl: null,
  targetBranch: 'main',
  targetRepo: 'org/repo',
  title: 't',
}

describe('renderPrompt — required secrets', () => {
  it('has_required_secrets is false when no secrets declared', () => {
    const out = renderPrompt(
      '{{#has_required_secrets}}SEC{{/has_required_secrets}}X',
      TASK,
    )
    expect(out).toBe('X')
  })

  it('has_required_secrets is false when empty array passed', () => {
    const out = renderPrompt(
      '{{#has_required_secrets}}SEC{{/has_required_secrets}}X',
      TASK,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
    )
    expect(out).toBe('X')
  })

  it('has_required_secrets renders list with names and descriptions', () => {
    const out = renderPrompt(
      '{{#has_required_secrets}}{{#required_secrets_list}}- {{ name }}|{{ description }}\n{{/required_secrets_list}}{{/has_required_secrets}}',
      TASK,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [
        { name: 'A', description: 'alpha' },
        { name: 'B', description: null },
      ],
    )
    expect(out).toContain('- A|alpha')
    expect(out).toContain('- B|')
  })

  it('has_required_secrets is true when secrets are provided', () => {
    const out = renderPrompt(
      '{{#has_required_secrets}}YES{{/has_required_secrets}}{{^has_required_secrets}}NO{{/has_required_secrets}}',
      TASK,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [{ name: 'TOKEN', description: 'a token' }],
    )
    expect(out).toBe('YES')
  })
})
