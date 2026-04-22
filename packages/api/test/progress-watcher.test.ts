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
import { agentStateDir, progressPath } from '../src/workspace/agent-state'
import {
  parseProgressLines,
  watchProgress,
} from '../src/workspace/progress-watcher'

const VALID_ULID = '01HYX3KPQR000000000000000A'
let tempRoot: string
let config: ReturnType<typeof ConfigSchema.parse>

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'hb-progress-'))
  config = ConfigSchema.parse({ agent: { state_root: tempRoot } })
  mkdirSync(agentStateDir(config, VALID_ULID), { recursive: true })
})

afterEach(() => {
  rmSync(tempRoot, { force: true, recursive: true })
})

describe('parseProgressLines', () => {
  it('parses well-formed NDJSON entries, skipping blanks', () => {
    const { entries, remainder } = parseProgressLines(
      '{"step":1,"total":3,"label":"a","status":"in_progress","ts":"t"}\n\n{"step":2,"total":3,"label":"b","status":"done","ts":"t"}\n',
    )
    expect(entries).toHaveLength(2)
    expect(entries[0]?.label).toBe('a')
    expect(entries[1]?.status).toBe('done')
    expect(remainder).toBe('')
  })

  it('skips malformed lines without throwing', () => {
    const { entries, remainder } = parseProgressLines(
      'not-json\n{"step":1,"total":1,"label":"ok","status":"done","ts":"t"}\n',
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]?.label).toBe('ok')
    expect(remainder).toBe('')
  })

  it('holds the trailing partial line as remainder', () => {
    const { entries, remainder } = parseProgressLines(
      '{"step":1,"total":1,"label":"ok","status":"done","ts":"t"}\n{"step":2',
    )
    expect(entries).toHaveLength(1)
    expect(remainder).toBe('{"step":2')
  })

  it('rejects entries missing required fields', () => {
    const { entries } = parseProgressLines('{"step":1,"label":"x"}\n')
    expect(entries).toHaveLength(0)
  })
})

describe('watchProgress', () => {
  it('emits parsed entries for each appended line (debounced)', async () => {
    const events: Array<{ label: string; status: string }> = []
    const dispose = watchProgress(config, VALID_ULID, (entry) => {
      events.push({ label: entry.label, status: entry.status })
    })

    writeFileSync(
      progressPath(config, VALID_ULID),
      '{"step":1,"total":3,"label":"a","status":"in_progress","ts":"t"}\n',
    )
    await new Promise((r) => setTimeout(r, 200))

    appendFileSync(
      progressPath(config, VALID_ULID),
      '{"step":1,"total":3,"label":"a","status":"done","ts":"t"}\n',
    )
    await new Promise((r) => setTimeout(r, 200))

    dispose()
    expect(events.map((e) => `${e.label}:${e.status}`)).toEqual([
      'a:in_progress',
      'a:done',
    ])
  })

  it('does not re-emit entries already delivered across multiple fires', async () => {
    const events: string[] = []
    const dispose = watchProgress(config, VALID_ULID, (e) => {
      events.push(e.label)
    })

    writeFileSync(
      progressPath(config, VALID_ULID),
      '{"step":1,"total":2,"label":"first","status":"done","ts":"t"}\n',
    )
    await new Promise((r) => setTimeout(r, 200))

    appendFileSync(
      progressPath(config, VALID_ULID),
      '{"step":2,"total":2,"label":"second","status":"done","ts":"t"}\n',
    )
    await new Promise((r) => setTimeout(r, 200))

    dispose()
    expect(events).toEqual(['first', 'second'])
  })

  it('delivers entries written during an in-flight pump (no dropped signals)', async () => {
    const events: string[] = []
    // Slow the subscriber so pump stays "in flight" while write #2 lands.
    const dispose = watchProgress(config, VALID_ULID, async (e) => {
      events.push(e.label)
      await new Promise((r) => setTimeout(r, 150))
    })

    writeFileSync(
      progressPath(config, VALID_ULID),
      '{"step":1,"total":2,"label":"first","status":"done","ts":"t"}\n',
    )
    // Wait just long enough for the debounce to fire and pump to START,
    // but NOT long enough for the slow onEntry to resolve.
    await new Promise((r) => setTimeout(r, 130))
    appendFileSync(
      progressPath(config, VALID_ULID),
      '{"step":2,"total":2,"label":"second","status":"done","ts":"t"}\n',
    )
    // Give everything plenty of time to settle.
    await new Promise((r) => setTimeout(r, 600))

    dispose()
    expect(events).toEqual(['first', 'second'])
  })
})
