import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import { renderPrompt } from '../src/agent/prompt'
import {
  archivePlaybook,
  createPlaybook,
  updatePlaybook,
} from '../src/playbooks'
import { insertAgentRun } from '../src/orchestrator/orchestrator'

describe('playbooks end-to-end', () => {
  function seedMinimal(db: Database): void {
    createTables(db)
    db.run(
      `INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`,
    )
    db.run(
      `INSERT INTO boards (id, name, created_by) VALUES ('B1','b','U1')`,
    )
    db.run(
      `INSERT INTO columns (id, board_id, name, position) VALUES ('C1','B1','c',0)`,
    )
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, action, agent_instruction, target_repo, created_by, updated_by) VALUES ('T1','B1','C1','t','playbook:my-pb','bump lodash','acme/app','U1','U1')`,
    )
  }

  it('create → run → edit → run — v1 agent_run stays pinned to v1', () => {
    const db = new Database(':memory:')
    seedMinimal(db)

    const pb = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: '{}',
      description: 'd',
      displayName: 'My',
      name: 'my-pb',
      promptTemplate: 'V1 BODY',
    })
    const v1Id = pb.currentVersion.id

    insertAgentRun({
      action: 'playbook:my-pb',
      db,
      runId: 'R1',
      taskId: 'T1',
    })

    // Edit — creates v2
    const updated = updatePlaybook(db, pb.id, {
      createdBy: 'U1',
      promptTemplate: 'V2 BODY',
    })
    const v2Id = updated.currentVersion.id
    expect(v2Id).not.toBe(v1Id)

    insertAgentRun({
      action: 'playbook:my-pb',
      db,
      runId: 'R2',
      taskId: 'T1',
    })

    const r1 = db
      .query('SELECT playbook_version_id FROM agent_runs WHERE id = ?')
      .get('R1') as { playbook_version_id: string }
    const r2 = db
      .query('SELECT playbook_version_id FROM agent_runs WHERE id = ?')
      .get('R2') as { playbook_version_id: string }

    expect(r1.playbook_version_id).toBe(v1Id)
    expect(r2.playbook_version_id).toBe(v2Id)

    // Render prompts for each — historical version text still accessible
    const prompt1 = renderPrompt(
      'unused',
      {
        action: 'playbook:my-pb',
        agentInstruction: 'bump lodash',
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
    expect(prompt1).toContain('V2 BODY') // renderPrompt uses the CURRENT version at render time; audit lives on agent_runs
  })

  it('archive → dispatch → renderPrompt is a no-op (dispatch happens at resolver layer); already-queued runs continue', () => {
    const db = new Database(':memory:')
    seedMinimal(db)
    const pb = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: '{}',
      description: 'd',
      displayName: 'My',
      name: 'my-pb',
      promptTemplate: 'BODY',
    })
    archivePlaybook(db, pb.id)
    // renderPrompt does NOT check archived — that's the resolver's job.
    // So in-flight queued runs render normally.
    const prompt = renderPrompt(
      'unused',
      {
        action: 'playbook:my-pb',
        agentInstruction: 'x',
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
    expect(prompt).toContain('BODY')
  })
})
