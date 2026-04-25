export type CheckpointKind = 'assistant' | 'tool_use' | 'tool_result' | 'error'

export type Checkpoint = {
  turn: number
  kind: CheckpointKind
  summary: string
  rawBytes: number
}

const ROW_CAP_BYTES = 2 * 1024
const ERROR_CAP_BYTES = 1 * 1024
const TOOL_ARGS_CAP_BYTES = 1 * 1024
const BASH_CMD_CAP_BYTES = 500
const ASSISTANT_HEAD_TAIL = 200
const ASSISTANT_FULL_THRESHOLD = 400

const TEXT_ENCODER = new TextEncoder()

function utf8Bytes(s: string): number {
  return TEXT_ENCODER.encode(s).length
}

function truncateByBytes(s: string, maxBytes: number): string {
  if (utf8Bytes(s) <= maxBytes) return s
  const budget = Math.max(0, maxBytes - 3) // reserve 3 bytes for the '…' marker
  let bytes = 0
  let out = ''
  for (const cp of s) {
    // for…of yields whole codepoints, not UTF-16 code units.
    const add = TEXT_ENCODER.encode(cp).length
    if (bytes + add > budget) break
    out += cp
    bytes += add
  }
  return out + '…'
}

function capRow(s: string): string {
  return utf8Bytes(s) <= ROW_CAP_BYTES ? s : truncateByBytes(s, ROW_CAP_BYTES)
}

function firstTextBlock(message: unknown): string | null {
  const content =
    (message as { content?: Array<{ type?: string; text?: string }> })?.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') return block.text
  }
  return null
}

function firstBlockOfType<T>(message: unknown, type: string): T | null {
  const content = (message as { content?: Array<{ type?: string }> })?.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (block?.type === type) return block as unknown as T
  }
  return null
}

function summarizeAssistant(text: string): string {
  const len = text.length
  if (len <= ASSISTANT_FULL_THRESHOLD) {
    return `[assistant, ${len} chars]: ${text}`
  }
  const codepoints = Array.from(text)
  const head = codepoints.slice(0, ASSISTANT_HEAD_TAIL).join('')
  const tail = codepoints.slice(-ASSISTANT_HEAD_TAIL).join('')
  return `[assistant, ${len} chars]: ${head} ... ${tail}`
}

/**
 * Replace the workspace root prefix with a repo-relative form so the running
 * log doesn't leak `/app/tmp/workspaces/<slug>/task-<ulid>/…` to users. If no
 * root is supplied (e.g. unit tests, legacy callers), returns the input
 * unchanged.
 */
function relToWorkspace(s: string, workspaceRoot?: string): string {
  if (!workspaceRoot) return s
  if (s === workspaceRoot) return '.'
  const prefix = workspaceRoot.endsWith('/') ? workspaceRoot : workspaceRoot + '/'
  if (s.startsWith(prefix)) {
    return s.slice(prefix.length) || '.'
  }
  // Best-effort replace for strings that embed the root (e.g. Bash commands).
  // Strip "<root>/" occurrences first so paths inside the workspace become
  // relative; then strip any remaining bare "<root>" tokens (e.g. `cd <root>`).
  let out = s.split(prefix).join('')
  if (out.includes(workspaceRoot)) {
    out = out.split(workspaceRoot).join('.')
  }
  return out
}

function summarizeToolUse(
  block: {
    name?: string
    input?: Record<string, unknown>
  },
  workspaceRoot?: string,
): string {
  const name = typeof block.name === 'string' ? block.name : 'unknown'
  const input = block.input ?? {}
  const rel = (s: string) => relToWorkspace(s, workspaceRoot)

  switch (name) {
    case 'Bash': {
      const cmd = typeof input.command === 'string' ? rel(input.command) : ''
      return `[tool Bash] ${truncateByBytes(cmd, BASH_CMD_CAP_BYTES)}`
    }
    case 'Read': {
      const path = typeof input.file_path === 'string' ? rel(input.file_path) : '?'
      return `[tool Read] ${path}`
    }
    case 'Write': {
      const path = typeof input.file_path === 'string' ? rel(input.file_path) : '?'
      const bytes =
        typeof input.content === 'string' ? utf8Bytes(input.content) : 0
      return `[tool Write] ${path} (${bytes} bytes)`
    }
    case 'Edit': {
      const path = typeof input.file_path === 'string' ? rel(input.file_path) : '?'
      const bytes =
        typeof input.new_string === 'string' ? utf8Bytes(input.new_string) : 0
      return `[tool Edit] ${path} (${bytes} bytes)`
    }
    case 'Grep':
    case 'Glob': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '?'
      const path = typeof input.path === 'string' ? rel(input.path) : '.'
      return `[tool ${name}] ${pattern} in ${path}`
    }
    default: {
      let argStr: string
      try {
        argStr = JSON.stringify(input)
      } catch {
        argStr = String(input)
      }
      return `[tool ${name}] ${truncateByBytes(rel(argStr), TOOL_ARGS_CAP_BYTES)}`
    }
  }
}

function summarizeToolResult(block: {
  name?: string
  is_error?: boolean
  content?: unknown
}): string {
  const name = typeof block.name === 'string' ? block.name : 'unknown'
  const exit = block.is_error ? 1 : 0
  let bytes = 0
  if (typeof block.content === 'string') {
    bytes = utf8Bytes(block.content)
  } else if (Array.isArray(block.content)) {
    for (const c of block.content as Array<{ type?: string; text?: string }>) {
      if (typeof c?.text === 'string') bytes += utf8Bytes(c.text)
    }
  }
  return `[result for ${name}] exit=${exit} bytes=${bytes}`
}

function summarizeError(evt: {
  result?: unknown
  error?: unknown
  message?: unknown
}): string {
  const msgRaw =
    typeof evt.result === 'string'
      ? evt.result
      : typeof evt.error === 'string'
        ? evt.error
        : typeof evt.message === 'string'
          ? evt.message
          : ''
  return `[error] ${truncateByBytes(msgRaw, ERROR_CAP_BYTES)}`
}

export function summarizeEvent(
  evt: unknown,
  turn: number,
  opts?: { rawBytes?: number; workspaceRoot?: string },
): Checkpoint | null {
  if (!evt || typeof evt !== 'object') return null
  const e = evt as Record<string, unknown>
  const type = typeof e.type === 'string' ? e.type : ''

  if (type === 'result' && (e.is_error === true || e.subtype === 'error')) {
    return {
      kind: 'error',
      rawBytes: opts?.rawBytes ?? 0,
      summary: capRow(summarizeError(e)),
      turn,
    }
  }

  if (type === 'assistant') {
    const tu = firstBlockOfType<{
      type: string
      name?: string
      input?: Record<string, unknown>
    }>(e.message, 'tool_use')
    if (tu) {
      return {
        kind: 'tool_use',
        rawBytes: opts?.rawBytes ?? 0,
        summary: capRow(summarizeToolUse(tu, opts?.workspaceRoot)),
        turn,
      }
    }
    const text = firstTextBlock(e.message)
    if (typeof text === 'string' && text.length > 0) {
      return {
        kind: 'assistant',
        rawBytes: opts?.rawBytes ?? 0,
        summary: capRow(summarizeAssistant(text)),
        turn,
      }
    }
    return null
  }

  if (type === 'user') {
    const tr = firstBlockOfType<{
      type: string
      name?: string
      is_error?: boolean
      content?: unknown
    }>(e.message, 'tool_result')
    if (tr) {
      return {
        kind: 'tool_result',
        rawBytes: opts?.rawBytes ?? 0,
        summary: capRow(summarizeToolResult(tr)),
        turn,
      }
    }
    return null
  }

  return null
}
