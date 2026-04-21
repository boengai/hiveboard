import { describe, expect, it } from 'bun:test'
import type { TaskForPrompt } from '../src/agent/prompt'
import { renderPrompt } from '../src/agent/prompt'

const TASK: TaskForPrompt = {
  action: 'revise',
  agentInstruction: null,
  body: 'body',
  id: '01HYX3KPQR000000000000000A',
  prUrl: 'https://github.com/x/y/pull/1',
  targetBranch: 'main',
  targetRepo: 'x/y',
  title: 't',
}

const TEMPLATE = `
{{#auto_revise_from_verification}}
VERIFY_FAIL_BLOCK:
{{#verification_failures}}
- {{ label }} (exit {{ exit_code }}): {{ command }}
  OUTPUT: {{{ output }}}
{{/verification_failures}}
{{/auto_revise_from_verification}}
{{^auto_revise_from_verification}}
STANDARD_REVISE_BLOCK
{{/auto_revise_from_verification}}
`.trim()

describe('renderPrompt with verification failures', () => {
  it('renders standard block when no failures given', () => {
    const out = renderPrompt(TEMPLATE, TASK)
    expect(out).toContain('STANDARD_REVISE_BLOCK')
    expect(out).not.toContain('VERIFY_FAIL_BLOCK')
  })

  it('renders verification block when failures given (via 7th arg)', () => {
    const out = renderPrompt(TEMPLATE, TASK, undefined, undefined, '', [], {
      verification_failures: [
        {
          command: 'bun run test',
          exit_code: 1,
          label: 'test',
          output: 'oops',
        },
      ],
    })
    expect(out).toContain('VERIFY_FAIL_BLOCK')
    expect(out).toContain('- test (exit 1): bun run test')
    expect(out).toContain('OUTPUT: oops')
    expect(out).not.toContain('STANDARD_REVISE_BLOCK')
  })

  it('passes output through triple-mustache (raw HTML-safe)', () => {
    const out = renderPrompt(TEMPLATE, TASK, undefined, undefined, '', [], {
      verification_failures: [
        {
          command: 'bun run lint',
          exit_code: 1,
          label: 'lint',
          output: '<tag>&x</tag>',
        },
      ],
    })
    expect(out).toContain('<tag>&x</tag>')
    expect(out).not.toContain('&amp;')
    expect(out).not.toContain('&lt;')
  })
})
