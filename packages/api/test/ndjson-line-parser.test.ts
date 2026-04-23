import { describe, expect, it } from 'bun:test'
import { NDJSONLineParser } from '../src/agent/ndjson-line-parser'

describe('NDJSONLineParser', () => {
  it('emits parsed objects line-by-line', () => {
    const events: unknown[] = []
    const parser = new NDJSONLineParser((evt) => events.push(evt))
    parser.feed('{"a":1}\n{"b":2}\n')
    expect(events).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('retains a partial final line until next feed', () => {
    const events: unknown[] = []
    const parser = new NDJSONLineParser((evt) => events.push(evt))
    parser.feed('{"a":1}\n{"b":2')
    expect(events).toEqual([{ a: 1 }])
    parser.feed(',"c":3}\n')
    expect(events).toEqual([{ a: 1 }, { b: 2, c: 3 }])
  })

  it('handles a chunk that splits mid-JSON across three chunks', () => {
    const events: unknown[] = []
    const parser = new NDJSONLineParser((evt) => events.push(evt))
    parser.feed('{"hello":"wor')
    parser.feed('ld"}\n{"next":')
    parser.feed('true}\n')
    expect(events).toEqual([{ hello: 'world' }, { next: true }])
  })

  it('swallows malformed lines and continues', () => {
    const events: unknown[] = []
    const warnings: string[] = []
    const parser = new NDJSONLineParser(
      (evt) => events.push(evt),
      { onParseError: (_err, line) => warnings.push(line) },
    )
    parser.feed('{"ok":1}\nnot-json\n{"ok":2}\n')
    expect(events).toEqual([{ ok: 1 }, { ok: 2 }])
    expect(warnings).toEqual(['not-json'])
  })

  it('ignores empty lines', () => {
    const events: unknown[] = []
    const parser = new NDJSONLineParser((evt) => events.push(evt))
    parser.feed('\n\n{"x":1}\n\n')
    expect(events).toEqual([{ x: 1 }])
  })

  it('flush() parses any trailing line without a newline', () => {
    const events: unknown[] = []
    const parser = new NDJSONLineParser((evt) => events.push(evt))
    parser.feed('{"a":1}\n{"b":2}') // no trailing \n
    expect(events).toEqual([{ a: 1 }])
    parser.flush()
    expect(events).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('reports raw byte size of each parsed line to the callback', () => {
    const byteSizes: number[] = []
    const parser = new NDJSONLineParser((_evt, meta) => byteSizes.push(meta.rawBytes))
    parser.feed('{"a":1}\n{"b":22}\n')
    expect(byteSizes).toEqual([7, 8]) // raw UTF-8 bytes per line excluding \n
  })

  it('handles CRLF line endings', () => {
    const events: unknown[] = []
    const parser = new NDJSONLineParser((evt) => events.push(evt))
    parser.feed('{"a":1}\r\n{"b":2}\r\n')
    expect(events).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('preserves embedded escaped newlines inside JSON strings (does not split on them)', () => {
    const events: unknown[] = []
    const parser = new NDJSONLineParser((evt) => events.push(evt))
    parser.feed('{"text":"line one\\nline two"}\n')
    expect(events).toEqual([{ text: 'line one\nline two' }])
  })

  it('multibyte UTF-8 across a chunk boundary parses correctly', () => {
    const events: unknown[] = []
    const parser = new NDJSONLineParser((evt) => events.push(evt))
    // Build the JSON string then split the bytes deliberately mid-string.
    // '{"emoji":"🚀"}\n' — the emoji is 4 UTF-8 bytes (0xF0 0x9F 0x9A 0x80).
    // Split as a string boundary; we are feeding string chunks (already decoded).
    parser.feed('{"emoji":"🚀')
    parser.feed('"}\n')
    expect(events).toEqual([{ emoji: '🚀' }])
  })

  it('flush() on an empty buffer is a no-op', () => {
    const events: unknown[] = []
    const parser = new NDJSONLineParser((evt) => events.push(evt))
    parser.flush()
    expect(events).toEqual([])
  })
})
