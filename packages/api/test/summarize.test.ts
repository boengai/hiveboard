import { describe, expect, it } from 'bun:test'
import { summarizeEvent } from '../src/agent/summarize'

describe('summarizeEvent', () => {
  it('returns null for events we do not track', () => {
    expect(summarizeEvent({ type: 'system' }, 1)).toBeNull()
    expect(summarizeEvent({ type: 'unknown_kind' }, 1)).toBeNull()
  })

  it('summarizes assistant text shorter than 400 chars as full text', () => {
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello world' }] },
      },
      1,
    )
    expect(cp?.kind).toBe('assistant')
    expect(cp?.summary).toContain('hello world')
    expect(cp?.summary).toContain('11 chars')
  })

  it('summarizes assistant text over 400 chars as first 200 + last 200', () => {
    const text = 'A'.repeat(150) + 'X'.repeat(200) + 'Z'.repeat(150)
    const cp = summarizeEvent(
      { type: 'assistant', message: { content: [{ type: 'text', text }] } },
      2,
    )
    expect(cp?.kind).toBe('assistant')
    expect(cp?.summary.length).toBeLessThanOrEqual(2048)
    expect(cp?.summary).toContain('...')
    expect(cp?.summary).toContain('A'.repeat(150))
    expect(cp?.summary).toContain('Z'.repeat(150))
    expect(cp?.summary).toContain('500 chars') // total length
  })

  it('summarizes Bash tool_use with command truncated to 500 chars', () => {
    const cmd = 'echo ' + 'x'.repeat(600)
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: cmd, description: 'long echo' },
            },
          ],
        },
      },
      3,
    )
    expect(cp?.kind).toBe('tool_use')
    expect(cp?.summary).toContain('Bash')
    expect(cp?.summary.length).toBeLessThanOrEqual(2048)
    expect(cp?.summary).toContain('x'.repeat(100))
    expect(cp?.summary).toContain('…')
  })

  it('summarizes Read tool_use with file path only', () => {
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: '/workspace/src/foo.ts' },
            },
          ],
        },
      },
      4,
    )
    expect(cp?.summary).toBe('[tool Read] /workspace/src/foo.ts')
  })

  it('summarizes Write tool_use with path and byte count', () => {
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: {
                file_path: '/workspace/src/foo.ts',
                content: 'console.log(1)',
              },
            },
          ],
        },
      },
      5,
    )
    expect(cp?.summary).toContain('/workspace/src/foo.ts')
    expect(cp?.summary).toMatch(/\b14 bytes\b/)
  })

  it('summarizes Edit tool_use with path and byte count of new_string', () => {
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              input: {
                file_path: '/workspace/src/foo.ts',
                old_string: 'a',
                new_string: 'abcd',
              },
            },
          ],
        },
      },
      6,
    )
    expect(cp?.summary).toContain('/workspace/src/foo.ts')
    expect(cp?.summary).toMatch(/\b4 bytes\b/)
  })

  it('summarizes Grep tool_use with pattern and path', () => {
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Grep',
              input: { pattern: 'TODO', path: 'src/' },
            },
          ],
        },
      },
      7,
    )
    expect(cp?.summary).toBe('[tool Grep] TODO in src/')
  })

  it('summarizes Glob tool_use with pattern and path', () => {
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Glob',
              input: { pattern: '**/*.ts', path: 'src/' },
            },
          ],
        },
      },
      8,
    )
    expect(cp?.summary).toContain('**/*.ts')
    expect(cp?.summary).toContain('src/')
  })

  it('summarizes unknown tool_use as name + stringified args capped at 1 KB', () => {
    const args = { blob: 'y'.repeat(2000) }
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'MysteryTool', input: args }],
        },
      },
      9,
    )
    expect(cp?.summary).toContain('MysteryTool')
    expect(cp?.summary.length).toBeLessThanOrEqual(2048)
  })

  it('summarizes tool_result as exit code + bytes and never includes contents', () => {
    const content = 'SECRET_TOKEN_abc123'
    const cp = summarizeEvent(
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              name: 'Bash',
              is_error: false,
              content,
            },
          ],
        },
      },
      10,
    )
    expect(cp?.kind).toBe('tool_result')
    expect(cp?.summary).not.toContain('SECRET_TOKEN')
    expect(cp?.summary).toContain('Bash')
    expect(cp?.summary).toMatch(/\bbytes=\d+\b/)
    expect(cp?.summary).toMatch(/exit=0\b/)
  })

  it('records non-zero exit in tool_result summary', () => {
    const cp = summarizeEvent(
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              name: 'Bash',
              is_error: true,
              content: 'oh no',
            },
          ],
        },
      },
      11,
    )
    expect(cp?.summary).toMatch(/exit=1\b/)
  })

  it('summarizes error event, capped at 1 KB', () => {
    const big = 'e'.repeat(2000)
    const cp = summarizeEvent({ type: 'result', is_error: true, result: big }, 12)
    expect(cp?.kind).toBe('error')
    expect(cp?.summary).toContain('[error]')
    expect(cp?.summary.length).toBeLessThanOrEqual(1024 + 32)
  })

  it('never returns a summary longer than 2 KB', () => {
    const huge = 'z'.repeat(10 * 1024)
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: huge }] },
      },
      13,
    )
    expect(cp!.summary.length).toBeLessThanOrEqual(2048)
  })

  it('populates turn and rawBytes correctly', () => {
    const evt = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }] },
    }
    const cp = summarizeEvent(evt, 42, { rawBytes: 128 })
    expect(cp?.turn).toBe(42)
    expect(cp?.rawBytes).toBe(128)
  })
})

describe('summarizeEvent — workspaceRoot stripping', () => {
  const root = '/app/tmp/workspaces/some-repo/task-01KPZZ'

  it('strips workspace root prefix from Read paths', () => {
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: `${root}/src/index.css` },
            },
          ],
        },
      },
      1,
      { workspaceRoot: root },
    )
    expect(cp?.summary).toBe('[tool Read] src/index.css')
  })

  it('strips workspace root prefix from Write and Edit paths', () => {
    const write = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: {
                file_path: `${root}/src/App.tsx`,
                content: 'x',
              },
            },
          ],
        },
      },
      2,
      { workspaceRoot: root },
    )
    expect(write?.summary).toContain('src/App.tsx')
    expect(write?.summary).not.toContain(root)

    const edit = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              input: {
                file_path: `${root}/src/App.tsx`,
                old_string: 'a',
                new_string: 'b',
              },
            },
          ],
        },
      },
      3,
      { workspaceRoot: root },
    )
    expect(edit?.summary).toContain('src/App.tsx')
    expect(edit?.summary).not.toContain(root)
  })

  it('strips workspace root from Bash commands anywhere in the string', () => {
    const cmd = `cd ${root} && ls ${root}/src`
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: cmd } }],
        },
      },
      4,
      { workspaceRoot: root },
    )
    expect(cp?.summary).not.toContain(root)
    expect(cp?.summary).toContain('ls src')
  })

  it('maps exact workspace root to "."', () => {
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: root },
            },
          ],
        },
      },
      5,
      { workspaceRoot: root },
    )
    expect(cp?.summary).toBe('[tool Read] .')
  })

  it('leaves paths outside the workspace root untouched', () => {
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: '/etc/hosts' },
            },
          ],
        },
      },
      6,
      { workspaceRoot: root },
    )
    expect(cp?.summary).toBe('[tool Read] /etc/hosts')
  })

  it('is a no-op when workspaceRoot is not provided', () => {
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: `${root}/src/index.css` },
            },
          ],
        },
      },
      7,
    )
    expect(cp?.summary).toBe(`[tool Read] ${root}/src/index.css`)
  })
})

describe('summarizeEvent — UTF-8 / UTF-16 safety', () => {
  it('truncateByBytes never produces invalid UTF-16 when cutting a supplementary-plane character', () => {
    // Build a string of 600 emoji rockets (each is 4 UTF-8 bytes, 2 UTF-16 units).
    // 600 * 4 = 2400 bytes — well over the Bash command 500-byte cap.
    const emojiCmd = '🚀'.repeat(600)
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: emojiCmd } },
          ],
        },
      },
      1,
    )
    expect(cp?.summary).toMatch(/…$/)
    // The truncated payload must round-trip cleanly through encode/decode.
    const encoded = new TextEncoder().encode(cp!.summary)
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(encoded)
    expect(decoded).toBe(cp!.summary)
    // No replacement chars (U+FFFD).
    expect(cp!.summary).not.toContain('�')
    // Conservative byte cap: row cap (2 KB) honoured strictly.
    expect(new TextEncoder().encode(cp!.summary).length).toBeLessThanOrEqual(2048)
  })

  it('summarizeAssistant head/tail never splits a surrogate pair', () => {
    // Exactly position the emoji at index 199/200 to force a UTF-16 split if naive.
    const text =
      'a'.repeat(199) + '🚀' + 'b'.repeat(199) + '🌟' + 'c'.repeat(200)
    const cp = summarizeEvent(
      { type: 'assistant', message: { content: [{ type: 'text', text }] } },
      2,
    )
    // Round-trip cleanly: no lone surrogates means strict UTF-8 decode succeeds.
    const encoded = new TextEncoder().encode(cp!.summary)
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(encoded)
    expect(decoded).toBe(cp!.summary)
    expect(cp!.summary).not.toContain('�')
  })

  it('truncateByBytes honours the byte cap exactly (no off-by-N overshoot)', () => {
    // Use a value where the spec promises a strict cap.
    const huge = 'z'.repeat(10 * 1024)
    const cp = summarizeEvent(
      { type: 'assistant', message: { content: [{ type: 'text', text: huge }] } },
      3,
    )
    expect(new TextEncoder().encode(cp!.summary).length).toBeLessThanOrEqual(2048)
  })

  it('Bash command containing a wide emoji at the cap boundary stays valid UTF-8', () => {
    const cmd = 'echo ' + 'x'.repeat(490) + '🚀rest'
    const cp = summarizeEvent(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: cmd } }],
        },
      },
      4,
    )
    const encoded = new TextEncoder().encode(cp!.summary)
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(encoded)
    expect(decoded).toBe(cp!.summary)
  })
})
