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

const TEMPLATE = `
{{#scratchpad}}
SCRATCHPAD:
{{{scratchpad}}}
{{/scratchpad}}
{{^scratchpad}}
NO_SCRATCHPAD
{{/scratchpad}}
`.trim()

describe('renderPrompt with scratchpad', () => {
  it('renders empty-state block when scratchpad is empty', () => {
    const out = renderPrompt(TEMPLATE, TASK, undefined, undefined, '')
    expect(out).toContain('NO_SCRATCHPAD')
    expect(out).not.toContain('SCRATCHPAD:')
  })

  it('renders scratchpad contents when non-empty', () => {
    const out = renderPrompt(
      TEMPLATE,
      TASK,
      undefined,
      undefined,
      '# notes from last run',
    )
    expect(out).toContain('SCRATCHPAD:')
    expect(out).toContain('# notes from last run')
  })

  it('does not HTML-escape the scratchpad', () => {
    const out = renderPrompt(
      TEMPLATE,
      TASK,
      undefined,
      undefined,
      '<decision>x & y</decision>',
    )
    expect(out).toContain('<decision>x & y</decision>')
  })

  it('treats omitted scratchpad arg as empty', () => {
    const out = renderPrompt(TEMPLATE, TASK)
    expect(out).toContain('NO_SCRATCHPAD')
  })
})
