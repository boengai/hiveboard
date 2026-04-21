import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ConfigSchema } from '../src/config/schema'
import {
  agentStateDir,
  deleteAgentState,
  readScratchpad,
  scratchpadPath,
  sweepOrphanAgentStateDirs,
} from '../src/workspace/agent-state'

const VALID_ULID = '01HYX3KPQR000000000000000A'
const INVALID_ULIDS = [
  '../evil',
  'short',
  'lowercase01hyx3kpqr000000000000',
  '',
]

const config = ConfigSchema.parse({
  agent: { state_root: './tmp/agent-state-test' },
})
const expectedRoot = resolve('./tmp/agent-state-test')

describe('agentStateDir', () => {
  it('returns resolved path under agent.state_root', () => {
    const dir = agentStateDir(config, VALID_ULID)
    expect(dir).toContain(VALID_ULID)
    expect(dir.endsWith(VALID_ULID)).toBe(true)
    expect(dir).toBe(join(expectedRoot, VALID_ULID))
  })

  it('throws on invalid task id', () => {
    for (const bad of INVALID_ULIDS) {
      expect(() => agentStateDir(config, bad)).toThrow()
    }
  })
})

describe('scratchpadPath', () => {
  it('returns {state_dir}/scratchpad.md for a valid id', () => {
    const p = scratchpadPath(config, VALID_ULID)
    expect(p.endsWith(join(VALID_ULID, 'scratchpad.md'))).toBe(true)
  })
})

describe('readScratchpad', () => {
  let tempRoot: string
  let testConfig: ReturnType<typeof ConfigSchema.parse>

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hb-read-'))
    testConfig = ConfigSchema.parse({ agent: { state_root: tempRoot } })
  })

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true })
  })

  it('returns "" when file is absent', async () => {
    const result = await readScratchpad(testConfig, VALID_ULID)
    expect(result).toBe('')
  })

  it('returns file contents when under 64 KB', async () => {
    const dir = join(tempRoot, VALID_ULID)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'scratchpad.md'), 'hello world')
    const result = await readScratchpad(testConfig, VALID_ULID)
    expect(result).toBe('hello world')
  })

  it('returns last 64 KB prefixed with truncation marker for large files', async () => {
    const dir = join(tempRoot, VALID_ULID)
    mkdirSync(dir, { recursive: true })
    const big = 'A'.repeat(70 * 1024) // 70 KB
    writeFileSync(join(dir, 'scratchpad.md'), big)
    const result = await readScratchpad(testConfig, VALID_ULID)
    expect(result.startsWith('<!-- truncated:')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(64 * 1024 + 200) // marker adds ~50 chars; leave slack
  })

  it('returns "" on invalid task id (no throw)', async () => {
    const result = await readScratchpad(testConfig, '../evil')
    expect(result).toBe('')
  })
})

describe('deleteAgentState', () => {
  let tempRoot: string
  let testConfig: ReturnType<typeof ConfigSchema.parse>

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hb-del-'))
    testConfig = ConfigSchema.parse({ agent: { state_root: tempRoot } })
  })

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true })
  })

  it('removes the per-task directory recursively', async () => {
    const dir = join(tempRoot, VALID_ULID)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'scratchpad.md'), 'hello')
    await deleteAgentState(testConfig, VALID_ULID)
    expect(existsSync(dir)).toBe(false)
  })

  it('is idempotent on a missing directory', async () => {
    await deleteAgentState(testConfig, VALID_ULID)
    await deleteAgentState(testConfig, VALID_ULID)
    expect(existsSync(join(tempRoot, VALID_ULID))).toBe(false)
  })

  it('does not throw on invalid task id', async () => {
    await deleteAgentState(testConfig, '../evil')
  })
})

describe('sweepOrphanAgentStateDirs', () => {
  let tempRoot: string
  let testConfig: ReturnType<typeof ConfigSchema.parse>

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hb-sweep-'))
    testConfig = ConfigSchema.parse({ agent: { state_root: tempRoot } })
  })

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true })
  })

  it('removes directories whose name is not a live ULID', async () => {
    const live = VALID_ULID
    const orphan = '01HYX3KPQR000000000000000B'
    mkdirSync(join(tempRoot, live), { recursive: true })
    mkdirSync(join(tempRoot, orphan), { recursive: true })
    mkdirSync(join(tempRoot, 'not-a-ulid'), { recursive: true })

    await sweepOrphanAgentStateDirs(testConfig, new Set([live]))

    expect(existsSync(join(tempRoot, live))).toBe(true)
    expect(existsSync(join(tempRoot, orphan))).toBe(false)
    expect(existsSync(join(tempRoot, 'not-a-ulid'))).toBe(false)
  })

  it('returns cleanly if state_root does not exist', async () => {
    rmSync(tempRoot, { force: true, recursive: true })
    await sweepOrphanAgentStateDirs(testConfig, new Set())
  })
})
