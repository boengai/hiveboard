import { resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { renderPrompt } from '../src/agent/prompt'
import { createTables } from '../src/db/schema'
import { createPlaybook } from '../src/playbooks'

const WORKFLOW_PATH = resolve(__dirname, '..', 'WORKFLOW.md')

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
  createTables(db)
  db.run(
    `INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`,
  )
})

afterEach(() => db.close())

describe('renderPrompt dispatch', () => {
  it('action "plan" uses WORKFLOW.md template (contains "Action: plan")', async () => {
    const { loadWorkflow } = await import('../src/config/loader')
    const { promptTemplate } = await loadWorkflow(WORKFLOW_PATH)
    const out = renderPrompt(promptTemplate, {
      action: 'plan',
      agentInstruction: 'x',
      body: 'b',
      id: 'T1',
      prUrl: null,
      targetBranch: 'main',
      targetRepo: 'acme/app',
      title: 't',
    })
    expect(out).toContain('Action: plan')
    expect(out).toContain('### Action: plan')
  })

  it('action "playbook:bump-dep" renders the playbook body, not WORKFLOW.md action blocks', async () => {
    createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: '{}',
      description: 'd',
      displayName: 'Bump',
      name: 'bump-dep',
      promptTemplate: 'PLAYBOOK BODY — target {{ task.agent_instruction }}',
    })
    const { loadWorkflow } = await import('../src/config/loader')
    const { promptTemplate } = await loadWorkflow(WORKFLOW_PATH)
    const out = renderPrompt(
      promptTemplate,
      {
        action: 'playbook:bump-dep',
        agentInstruction: 'lodash',
        body: 'b',
        id: 'T1',
        prUrl: null,
        targetBranch: 'main',
        targetRepo: 'acme/app',
        title: 't',
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { db },
    )
    expect(out).toContain('PLAYBOOK BODY — target lodash')
    expect(out).not.toContain('### Action: plan')
    expect(out).toContain('Action: playbook:bump-dep')
  })

  it('action "playbook:missing" throws a clear error', async () => {
    const { loadWorkflow } = await import('../src/config/loader')
    const { promptTemplate } = await loadWorkflow(WORKFLOW_PATH)
    expect(() =>
      renderPrompt(
        promptTemplate,
        {
          action: 'playbook:missing',
          agentInstruction: null,
          body: 'b',
          id: 'T1',
          prUrl: null,
          targetBranch: 'main',
          targetRepo: 'acme/app',
          title: 't',
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { db },
      ),
    ).toThrow(/Playbook not found/)
  })
})
