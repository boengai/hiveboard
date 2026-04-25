import { describe, expect, it } from 'bun:test'
import { parsePlanText } from '../src/orchestrator/orchestrator'

describe('parsePlanText — legacy --output-format json', () => {
  it('returns the string itself when the blob is a bare JSON string', () => {
    expect(parsePlanText(JSON.stringify('a plain plan'))).toBe('a plain plan')
  })

  it('picks the last text block from a JSON array', () => {
    const blob = JSON.stringify([
      { type: 'text', text: 'first' },
      { type: 'tool_use', name: 'Bash' },
      { type: 'text', text: 'final plan' },
    ])
    expect(parsePlanText(blob)).toBe('final plan')
  })

  it('prefers a trailing result block over earlier text', () => {
    const blob = JSON.stringify([
      { type: 'text', text: 'early' },
      { type: 'result', result: 'the result' },
    ])
    expect(parsePlanText(blob)).toBe('the result')
  })

  it('reads .result from an object blob', () => {
    expect(parsePlanText(JSON.stringify({ result: 'obj form' }))).toBe('obj form')
  })
})

describe('parsePlanText — stream-json JSONL', () => {
  it('extracts the terminal {type:"result"} event from JSONL', () => {
    const jsonl =
      JSON.stringify({
        type: 'system',
        subtype: 'hook_started',
      }) +
      '\n' +
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'thinking' }] },
      }) +
      '\n' +
      JSON.stringify({
        type: 'result',
        result: 'stream-json plan text',
        modelUsage: {},
      }) +
      '\n'
    expect(parsePlanText(jsonl)).toBe('stream-json plan text')
  })

  it('ignores error-result events with is_error:true', () => {
    const jsonl =
      JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'failure message',
      }) + '\n'
    expect(parsePlanText(jsonl)).toBe('')
  })

  it('returns the last result event when multiple are present', () => {
    const jsonl =
      JSON.stringify({ type: 'result', result: 'first' }) +
      '\n' +
      JSON.stringify({ type: 'result', result: 'last' }) +
      '\n'
    expect(parsePlanText(jsonl)).toBe('last')
  })

  it('skips non-JSON lines interleaved with events', () => {
    const jsonl =
      'some noise stderr line\n' +
      JSON.stringify({ type: 'result', result: 'recovered' }) +
      '\n'
    expect(parsePlanText(jsonl)).toBe('recovered')
  })
})

describe('parsePlanText — failure modes', () => {
  it('returns "" when no result event is present', () => {
    const jsonl =
      JSON.stringify({ type: 'system', subtype: 'startup' }) +
      '\n' +
      JSON.stringify({ type: 'assistant', message: { content: [] } }) +
      '\n'
    expect(parsePlanText(jsonl)).toBe('')
  })

  it('returns "" for unparseable garbage', () => {
    expect(parsePlanText('not json at all')).toBe('')
  })

  it('returns "" for an empty string', () => {
    expect(parsePlanText('')).toBe('')
  })
})
