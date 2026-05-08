import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { loadWorkflow } from '../src/config/loader'
import { renderPrompt, type RunAgentMessage } from '../src/agent/prompt'

const FIXTURE_DIR = resolve(__dirname, 'fixtures')
const WORKFLOW_PATH = resolve(__dirname, '..', 'WORKFLOW.md')

function readFixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), 'utf8')
}

const BASE_TASK = {
  action: 'plan' as string | null,
  agentInstruction: 'Investigate observability',
  body: 'Add Prometheus metrics to the request handler.',
  plan: null,
  id: '01HYX3KPQR000000000000000Z',
  prUrl: null,
  targetBranch: 'main',
  targetRepo: 'acme/app',
  title: 'Add Prometheus metrics',
}

describe('prompt golden fixtures (byte-identity gate for partial extraction)', () => {
  it('PLAN prompt matches fixture', async () => {
    const { promptTemplate } = await loadWorkflow(WORKFLOW_PATH)
    const out = renderPrompt(promptTemplate, { ...BASE_TASK, action: 'plan' })
    expect(out).toBe(readFixture('prompt-golden-plan.txt'))
  })

  it('IMPLEMENT prompt matches fixture', async () => {
    const { promptTemplate } = await loadWorkflow(WORKFLOW_PATH)
    const out = renderPrompt(promptTemplate, {
      ...BASE_TASK,
      action: 'implement',
    })
    expect(out).toBe(readFixture('prompt-golden-implement.txt'))
  })

  it('REVISE prompt matches fixture', async () => {
    const { promptTemplate } = await loadWorkflow(WORKFLOW_PATH)
    const out = renderPrompt(promptTemplate, {
      ...BASE_TASK,
      action: 'revise',
      prUrl: 'https://github.com/acme/app/pull/123',
    })
    expect(out).toBe(readFixture('prompt-golden-revise.txt'))
  })

  it('IMPLEMENT with messages matches fixture', async () => {
    const { promptTemplate } = await loadWorkflow(WORKFLOW_PATH)
    const messages: RunAgentMessage[] = [
      { body: 'Prefer pull-based metrics.', created_at: '2026-04-22T10:00:00Z', kind: 'hint' },
      { body: 'Use the histogram API.', created_at: '2026-04-22T10:05:00Z', kind: 'redirect' },
    ]
    const out = renderPrompt(
      promptTemplate,
      { ...BASE_TASK, action: 'implement' },
      undefined,
      undefined,
      '## 2026-04-22T09:00:00Z — PLAN\nPicked pull-based model.',
      messages,
    )
    expect(out).toBe(readFixture('prompt-golden-implement-with-messages.txt'))
  })

  it('REVISE with verification failures matches fixture', async () => {
    const { promptTemplate } = await loadWorkflow(WORKFLOW_PATH)
    const out = renderPrompt(
      promptTemplate,
      {
        ...BASE_TASK,
        action: 'revise',
        prUrl: 'https://github.com/acme/app/pull/123',
      },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        verification_failures: [
          {
            command: 'bun run tsc',
            exit_code: 1,
            label: 'tsc',
            output: "src/foo.ts(12,3): error TS2345: Argument of type 'string'",
          },
        ],
      },
    )
    expect(out).toBe(readFixture('prompt-golden-revise-with-verify.txt'))
  })
})
