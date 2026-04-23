import { describe, expect, it } from 'bun:test'
import {
  buildPlaybookTemplate,
  renderPlaybookPrompt,
} from '../src/playbooks/render'

describe('buildPlaybookTemplate', () => {
  it('wraps the body in the expected partial order', () => {
    const tpl = buildPlaybookTemplate('PLAYBOOK BODY HERE')
    // The partial order must match WORKFLOW.md ordering:
    // scratchpad → progress → messages → playbook_body → question → subtasks
    const iScratchpad = tpl.indexOf('{{> scratchpad}}')
    const iProgress = tpl.indexOf('{{> progress}}')
    const iMessages = tpl.indexOf('{{> messages}}')
    const iBody = tpl.indexOf('PLAYBOOK BODY HERE')
    const iQuestion = tpl.indexOf('{{> question}}')
    const iSubtasks = tpl.indexOf('{{> subtasks}}')
    expect(iScratchpad).toBeGreaterThan(-1)
    expect(iProgress).toBeGreaterThan(iScratchpad)
    expect(iMessages).toBeGreaterThan(iProgress)
    expect(iBody).toBeGreaterThan(iMessages)
    expect(iQuestion).toBeGreaterThan(iBody)
    expect(iSubtasks).toBeGreaterThan(iQuestion)
  })
})

describe('renderPlaybookPrompt', () => {
  it('renders a playbook body with task context and scratchpad', () => {
    const out = renderPlaybookPrompt({
      playbookBody: 'Target: {{ task.agent_instruction }}',
      scratchpad: 'prior note',
      task: {
        action: 'playbook:bump-dep',
        agentInstruction: 'bump lodash',
        body: 'b',
        id: 'T1',
        prUrl: null,
        targetBranch: 'main',
        targetRepo: 'acme/app',
        title: 't',
      },
    })
    expect(out).toContain('Target: bump lodash')
    expect(out).toContain('prior note')
    expect(out).toContain('Scratchpad — your memory') // from scratchpad partial
    expect(out).toContain('Asking the human a question') // from question partial
    expect(out).toContain('Spawning subtasks') // from subtasks partial
  })

  it('escapes HTML-ish characters in task body (no Mustache HTML escaping)', () => {
    const out = renderPlaybookPrompt({
      playbookBody: '{{ task.body }}',
      task: {
        action: 'playbook:x',
        agentInstruction: null,
        body: '<script>alert(1)</script>',
        id: 'T1',
        prUrl: null,
        targetBranch: 'main',
        targetRepo: 'acme/app',
        title: 't',
      },
    })
    // WORKFLOW.md already relies on Mustache.escape = identity; we must match.
    expect(out).toContain('<script>alert(1)</script>')
  })
})

describe('renderPlaybookPrompt with previous_attempt_replay', () => {
  const baseInput = {
    playbookBody: 'Do the playbook thing.',
    scratchpad: '',
    messages: [],
    task: {
      action: 'playbook:xyz',
      agentInstruction: null,
      body: 't',
      id: '01HYX3KPQR000000000000000A',
      prUrl: null,
      targetBranch: 'main',
      targetRepo: 'org/repo',
      title: 't',
    },
  }

  it('renders the replay block when replay is provided', () => {
    const out = renderPlaybookPrompt({
      ...baseInput,
      previousAttemptReplay: {
        failure_summary: 'exit code 1',
        turn_count: 3,
        checkpoints: [
          { turn: 1, kind: 'assistant', summary: 'first note' },
          { turn: 2, kind: 'error', summary: '[error] fatal' },
        ],
      },
    } as never)
    expect(out).toContain('Previous attempt replay')
    expect(out).toContain('failed at turn 3')
    expect(out).toContain('exit code 1')
    expect(out).toContain('[turn 1] assistant: first note')
    expect(out).toContain('[turn 2] error: [error] fatal')
  })

  it('omits the replay block when no replay is provided', () => {
    const out = renderPlaybookPrompt(baseInput as never)
    expect(out).not.toContain('Previous attempt replay')
  })
})
