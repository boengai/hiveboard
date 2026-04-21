import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '../src/config/schema'
import { agentStateDir, scratchpadPath } from '../src/workspace/agent-state'
import { watchScratchpad } from '../src/workspace/scratchpad-watcher'

const VALID_ULID = '01HYX3KPQR000000000000000A'
let tempRoot: string
let testConfig: ReturnType<typeof ConfigSchema.parse>

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'hb-watch-'))
  testConfig = ConfigSchema.parse({ agent: { state_root: tempRoot } })
  mkdirSync(agentStateDir(testConfig, VALID_ULID), { recursive: true })
})

afterEach(() => {
  rmSync(tempRoot, { force: true, recursive: true })
})

describe('watchScratchpad', () => {
  it('invokes the callback with initial contents on subscribe', async () => {
    writeFileSync(scratchpadPath(testConfig, VALID_ULID), 'initial')
    const events: string[] = []
    const dispose = watchScratchpad(testConfig, VALID_ULID, (content) => {
      events.push(content)
    })
    // Give the initial fire a moment.
    await new Promise((r) => setTimeout(r, 50))
    dispose()
    expect(events[0]).toBe('initial')
  })

  it('invokes the callback on file changes (debounced)', async () => {
    const events: string[] = []
    const dispose = watchScratchpad(testConfig, VALID_ULID, (content) => {
      events.push(content)
    })

    // Wait for initial fire to settle
    await new Promise((r) => setTimeout(r, 50))

    writeFileSync(scratchpadPath(testConfig, VALID_ULID), 'v1')
    await new Promise((r) => setTimeout(r, 350))
    writeFileSync(scratchpadPath(testConfig, VALID_ULID), 'v2')
    await new Promise((r) => setTimeout(r, 350))

    dispose()
    // At least two distinct versions observed.
    expect(events).toContain('v1')
    expect(events[events.length - 1]).toBe('v2')
  })

  it('coalesces rapid writes within the debounce window', async () => {
    const events: string[] = []
    const dispose = watchScratchpad(testConfig, VALID_ULID, (content) => {
      events.push(content)
    })

    // Wait for initial fire
    await new Promise((r) => setTimeout(r, 50))
    const countBeforeBurst = events.length

    writeFileSync(scratchpadPath(testConfig, VALID_ULID), 'a')
    writeFileSync(scratchpadPath(testConfig, VALID_ULID), 'b')
    writeFileSync(scratchpadPath(testConfig, VALID_ULID), 'c')
    await new Promise((r) => setTimeout(r, 400))

    dispose()
    const emittedDuringBurst = events.length - countBeforeBurst
    // 3 writes within the 250 ms debounce should collapse to 1-2 callbacks.
    expect(emittedDuringBurst).toBeLessThanOrEqual(2)
    expect(events[events.length - 1]).toBe('c')
  })

  it('returns a disposer that stops callbacks', async () => {
    const events: string[] = []
    const dispose = watchScratchpad(testConfig, VALID_ULID, (content) => {
      events.push(content)
    })
    await new Promise((r) => setTimeout(r, 50))
    dispose()
    writeFileSync(scratchpadPath(testConfig, VALID_ULID), 'after-dispose')
    await new Promise((r) => setTimeout(r, 350))
    // No new events after dispose (only the initial fire counts).
    expect(events).not.toContain('after-dispose')
  })
})
