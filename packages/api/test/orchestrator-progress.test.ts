import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '../src/config/schema'
import { createTables } from '../src/db/schema'
import { agentStateDir, progressPath } from '../src/workspace/agent-state'
import { watchProgress } from '../src/workspace/progress-watcher'

const TASK_ID = '01HYX3KPQR000000000000000A'

describe('progress watcher + snapshot loop end-to-end wiring', () => {
  let tempRoot: string
  let db: Database
  let config: ReturnType<typeof ConfigSchema.parse>

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hb-orch-prog-'))
    db = new Database(':memory:')
    createTables(db)
    config = ConfigSchema.parse({ agent: { state_root: tempRoot } })
    mkdirSync(agentStateDir(config, TASK_ID), { recursive: true })
  })

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true })
  })

  it('delivers appended progress entries via watchProgress', async () => {
    const events: string[] = []
    const dispose = watchProgress(config, TASK_ID, (e) => events.push(e.label))

    writeFileSync(
      progressPath(config, TASK_ID),
      '{"step":1,"total":2,"label":"alpha","status":"in_progress","ts":"t"}\n',
    )
    await new Promise((r) => setTimeout(r, 200))
    appendFileSync(
      progressPath(config, TASK_ID),
      '{"step":2,"total":2,"label":"beta","status":"done","ts":"t"}\n',
    )
    await new Promise((r) => setTimeout(r, 200))

    dispose()
    expect(events).toEqual(['alpha', 'beta'])
  })

  // Full orchestrator-to-DB path is covered by test/orchestrator.test.ts
  // via the public dispatch path rather than private helpers. This file
  // just pins down the watcher contract used by the orchestrator.
})
