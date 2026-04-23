export type NDJSONCallback = (
  evt: unknown,
  meta: { rawBytes: number },
) => void

export type NDJSONParseErrorCallback = (err: Error, line: string) => void

export type NDJSONParserOptions = {
  onParseError?: NDJSONParseErrorCallback
}

const TEXT_ENCODER = new TextEncoder()

export class NDJSONLineParser {
  private buffer = ''
  constructor(
    private readonly onEvent: NDJSONCallback,
    private readonly options: NDJSONParserOptions = {},
  ) {}

  feed(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line.length === 0) continue
      this.emit(line)
    }
  }

  /** Parse any trailing buffered line that never received a terminator. */
  flush(): void {
    const remaining = this.buffer
    this.buffer = ''
    if (remaining.length === 0) return
    const line = remaining.endsWith('\r') ? remaining.slice(0, -1) : remaining
    if (line.length > 0) this.emit(line)
  }

  private emit(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (err) {
      this.options.onParseError?.(err as Error, line)
      return
    }
    const rawBytes = TEXT_ENCODER.encode(line).length
    this.onEvent(parsed, { rawBytes })
  }
}
