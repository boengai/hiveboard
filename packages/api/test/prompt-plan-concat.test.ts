import { describe, expect, it } from 'bun:test'
import { buildPromptContext } from '../src/agent/prompt-context'
import type { TaskForPrompt } from '../src/agent/prompt'

const BASE: TaskForPrompt = {
  id: 't1',
  title: 'A title',
  body: 'A requirement.',
  plan: null,
  action: 'plan',
  agentInstruction: 'inst',
  targetRepo: 'acme/app',
  targetBranch: 'main',
  prUrl: null,
}

describe('buildPromptContext body/plan concat', () => {
  it('uses body unchanged when plan is null', () => {
    const ctx = buildPromptContext({ task: { ...BASE, plan: null } })
    expect(ctx.task.body).toBe('A requirement.')
  })

  it('appends ## Implementation Plan section when plan is set', () => {
    const ctx = buildPromptContext({
      task: { ...BASE, plan: 'Step one.\nStep two.' },
    })
    expect(ctx.task.body).toBe(
      'A requirement.\n\n## Implementation Plan\n\nStep one.\nStep two.',
    )
  })

  it('matches the legacy single-body format byte-for-byte', () => {
    // Two tasks:
    //   - new shape: body = req, plan = body of plan
    //   - legacy shape: body already contains the merged section, plan = null
    // Their rendered task.body must be identical.
    const newShape = buildPromptContext({
      task: { ...BASE, body: 'Req.', plan: 'Plan body.' },
    })
    const legacyShape = buildPromptContext({
      task: {
        ...BASE,
        body: 'Req.\n\n## Implementation Plan\n\nPlan body.',
        plan: null,
      },
    })
    expect(newShape.task.body).toBe(legacyShape.task.body)
  })

  it('trims trailing whitespace on body before appending heading', () => {
    const ctx = buildPromptContext({
      task: { ...BASE, body: 'Req.\n\n\n\n', plan: 'P.' },
    })
    expect(ctx.task.body).toBe('Req.\n\n## Implementation Plan\n\nP.')
  })
})
