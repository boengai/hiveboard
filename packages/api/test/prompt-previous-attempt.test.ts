import { describe, expect, it } from 'bun:test'
import { renderPrompt } from '../src/agent/prompt'

const TASK = {
  action: 'implement',
  agentInstruction: null,
  body: 'b',
  id: '01HYX3KPQR000000000000000A',
  prUrl: null,
  targetBranch: 'main',
  targetRepo: 'org/repo',
  title: 't',
} as const

const TEMPLATE = `
{{#previous_attempt_replay}}
REPLAY: failed at turn {{ turn_count }} with: {{ failure_summary }}
{{#checkpoints}}
- [{{ turn }}] {{ kind }}: {{{ summary }}}
{{/checkpoints}}
{{/previous_attempt_replay}}
{{^previous_attempt_replay}}
NO_REPLAY
{{/previous_attempt_replay}}
`.trim()

describe('renderPrompt with previous_attempt_replay', () => {
  it('renders NO_REPLAY when no replay context supplied', () => {
    const out = renderPrompt(TEMPLATE, TASK)
    expect(out).toContain('NO_REPLAY')
    expect(out).not.toContain('REPLAY:')
  })

  it('renders the replay block with checkpoints when supplied', () => {
    const out = renderPrompt(
      TEMPLATE,
      TASK,
      2, // attempt
      undefined, // reviewComments
      undefined, // scratchpad
      undefined, // messages
      undefined, // verification
      {
        // previousAttemptReplay
        checkpoints: [
          { kind: 'assistant', summary: 'first note', turn: 1 },
          { kind: 'tool_use', summary: '[tool Bash] ls', turn: 2 },
          { kind: 'error', summary: '[error] fatal', turn: 3 },
        ],
        failure_summary: 'exit code 1',
        turn_count: 3,
      },
    )
    expect(out).toContain('REPLAY: failed at turn 3 with: exit code 1')
    expect(out).toContain('- [1] assistant: first note')
    expect(out).toContain('- [2] tool_use: [tool Bash] ls')
    expect(out).toContain('- [3] error: [error] fatal')
  })

  it('does not HTML-escape summary content (triple-brace)', () => {
    const out = renderPrompt(
      TEMPLATE,
      TASK,
      2,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        checkpoints: [
          { kind: 'tool_use', summary: '[tool Bash] echo "<x>" & ok', turn: 1 },
        ],
        failure_summary: 'boom',
        turn_count: 1,
      },
    )
    expect(out).toContain('<x>')
    expect(out).toContain('&')
  })
})
