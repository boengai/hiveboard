import { afterEach, describe, expect, it } from 'bun:test'
import {
  checkpointsSupported,
  detectCheckpointSupport,
  _setCheckpointSupportForTest,
} from '../src/agent/capability'

describe('checkpoint capability', () => {
  afterEach(() => _setCheckpointSupportForTest(undefined))

  it('defaults to false before detection runs', () => {
    _setCheckpointSupportForTest(undefined)
    expect(checkpointsSupported()).toBe(false)
  })

  it('returns true when claude --help contains stream-json', async () => {
    const fakeSpawn = () => ({
      exited: Promise.resolve(0),
      stdout: new Response('--output-format <format>  ... stream-json')
        .body as ReadableStream,
      stderr: new Response('').body as ReadableStream,
    })
    const supported = await detectCheckpointSupport({
      spawn: fakeSpawn as never,
      command: 'claude',
    })
    expect(supported).toBe(true)
    expect(checkpointsSupported()).toBe(true)
  })

  it('returns false when claude --help lacks stream-json', async () => {
    const fakeSpawn = () => ({
      exited: Promise.resolve(0),
      stdout: new Response('--output-format <format>  text|json').body as ReadableStream,
      stderr: new Response('').body as ReadableStream,
    })
    const supported = await detectCheckpointSupport({
      spawn: fakeSpawn as never,
      command: 'claude',
    })
    expect(supported).toBe(false)
  })

  it('returns false and logs when claude binary fails to spawn', async () => {
    const fakeSpawn = () => {
      throw new Error('ENOENT')
    }
    const supported = await detectCheckpointSupport({
      spawn: fakeSpawn as never,
      command: 'claude',
    })
    expect(supported).toBe(false)
  })
})
