import { describe, expect, it } from 'bun:test'
import type { TaskForPrompt } from '../src/agent/prompt'
import { renderPrompt } from '../src/agent/prompt'
import { escapeMustacheSyntax } from '../src/orchestrator/orchestrator'

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

const TEMPLATE =
  '{{#has_messages}}MSG:{{#messages}}{{kind}}={{body}}@{{created_at}};{{/messages}}{{/has_messages}}{{^has_messages}}NONE{{/has_messages}}'

describe('renderPrompt — messages', () => {
  it('renders empty-state branch when messages is undefined', () => {
    expect(renderPrompt(TEMPLATE, TASK)).toBe('NONE')
  })

  it('renders empty-state branch when messages is an empty array', () => {
    expect(
      renderPrompt(TEMPLATE, TASK, undefined, undefined, undefined, []),
    ).toBe('NONE')
  })

  it('iterates message entries when present', () => {
    const out = renderPrompt(TEMPLATE, TASK, undefined, undefined, undefined, [
      { body: 'first', created_at: '2026-04-21T00:00:00Z', kind: 'hint' },
      {
        body: 'second',
        created_at: '2026-04-21T00:01:00Z',
        kind: 'redirect',
      },
    ])
    expect(out).toContain('MSG:')
    expect(out).toContain('hint=first@2026-04-21T00:00:00Z;')
    expect(out).toContain('redirect=second@2026-04-21T00:01:00Z;')
    expect(out).not.toContain('NONE')
  })

  it('preserves literal braces after escapeMustacheSyntax', () => {
    const body = escapeMustacheSyntax('{{injected}}')
    const out = renderPrompt(
      '{{#messages}}{{body}}{{/messages}}',
      TASK,
      undefined,
      undefined,
      undefined,
      [{ body, created_at: '2026-04-21', kind: 'hint' }],
    )
    // The injected tag name text survives, but Mustache should NOT have
    // interpreted it as a tag (since the opening `{{` was broken by the escape).
    expect(out).toContain('injected')
    expect(out).not.toContain('{{injected}}')
  })
})
