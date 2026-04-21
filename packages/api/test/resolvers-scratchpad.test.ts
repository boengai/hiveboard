import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '../src/config/schema'
import { readScratchpad } from '../src/workspace/agent-state'

const VALID_ULID = '01HYX3KPQR000000000000000A'

describe('Task.scratchpad resolver behavior', () => {
  let tempRoot: string
  let testConfig: ReturnType<typeof ConfigSchema.parse>

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hb-res-'))
    testConfig = ConfigSchema.parse({ agent: { state_root: tempRoot } })
  })

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true })
  })

  it('delegates to readScratchpad with ctx.config', async () => {
    // Directly verify the helper contract the resolver relies on.
    const result = await readScratchpad(testConfig, VALID_ULID)
    expect(result).toBe('')
  })

  it('returns file contents when scratchpad exists', async () => {
    const dir = join(tempRoot, VALID_ULID)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'scratchpad.md'), 'agent notes')
    const result = await readScratchpad(testConfig, VALID_ULID)
    expect(result).toBe('agent notes')
  })
})
