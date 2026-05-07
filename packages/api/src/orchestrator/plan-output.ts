/**
 * Claude CLI output parsing for plan-mode tasks. Pure text/JSON parsing —
 * no DB or filesystem.
 */

import { consola } from 'consola'

/**
 * Pull the plan text out of a Claude CLI run. Handles both output formats:
 *   - Legacy `--output-format json`: a single JSON blob (array of content
 *     blocks or `{result: ...}` object).
 *   - `--output-format stream-json`: JSONL, with a terminal
 *     `{type:"result", result:"..."}` event carrying the final text.
 *
 * Returns '' when no plan text can be recovered — the caller is expected to
 * return null in that case so we never dump raw CLI bytes into `tasks.body`.
 */
export function parsePlanText(rawOutput: string): string {
  // Legacy single-blob JSON first.
  try {
    const parsed = JSON.parse(rawOutput)
    if (typeof parsed === 'string') return parsed
    if (Array.isArray(parsed)) {
      let t = ''
      for (const block of parsed) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          t = block.text
        } else if (
          block?.type === 'result' &&
          typeof block.result === 'string'
        ) {
          t = block.result
        }
      }
      return t
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { result?: unknown }).result === 'string' &&
      (parsed as { is_error?: unknown }).is_error !== true
    ) {
      return (parsed as { result: string }).result
    }
  } catch {
    // Fall through to JSONL handling.
  }

  // stream-json: scan from the tail for the last {type:"result", result:"..."}.
  const lines = rawOutput.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim()
    if (!line) continue
    try {
      const evt = JSON.parse(line) as {
        type?: unknown
        result?: unknown
        is_error?: unknown
      }
      if (
        evt?.type === 'result' &&
        evt.is_error !== true &&
        typeof evt.result === 'string'
      ) {
        return evt.result
      }
    } catch {
      // Skip lines that aren't JSON (e.g. stderr-interleaved garbage).
    }
  }

  return ''
}

/**
 * Merge the Claude CLI plan text into the task body. Returns null when the
 * output contains no recoverable plan — the body is left untouched in that
 * case rather than corrupted with raw event stream bytes.
 */
export function extractPlanFromOutput(
  rawOutput: string,
  existingBody: string,
): string | null {
  const planText = parsePlanText(rawOutput).trim()
  if (!planText) {
    consola.warn(
      'extractPlanFromOutput: no plan text recovered from CLI output; leaving task body unchanged.',
    )
    return null
  }

  const planSection = `## Implementation Plan\n\n${planText}`
  const planRegex = /## Implementation Plan[\s\S]*$/
  if (planRegex.test(existingBody)) {
    return existingBody.replace(planRegex, planSection)
  }
  return existingBody
    ? `${existingBody.trimEnd()}\n\n${planSection}`
    : planSection
}
