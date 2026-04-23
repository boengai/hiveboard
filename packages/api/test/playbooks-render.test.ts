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
