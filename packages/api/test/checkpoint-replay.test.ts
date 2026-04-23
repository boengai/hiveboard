import { describe, expect, it } from 'bun:test'
import type { CheckpointRow } from '../src/db/checkpoints'
import { selectCheckpointsForReplay } from '../src/agent/checkpoint-replay'

function make(turn: number, kind: CheckpointRow['kind'], summary = ''): CheckpointRow {
  return {
    agentRunId: 'run',
    id: `cp-${turn}-${kind}`,
    kind,
    occurredAt: '2026-04-23T00:00:00Z',
    rawBytes: summary.length,
    summary: summary || `turn ${turn} ${kind}`,
    turn,
  }
}

describe('selectCheckpointsForReplay', () => {
  it('returns all checkpoints when under the cap', () => {
    const rows: CheckpointRow[] = Array.from({ length: 15 }, (_, i) =>
      make(i + 1, i % 2 === 0 ? 'assistant' : 'tool_use'),
    )
    const out = selectCheckpointsForReplay(rows)
    expect(out.length).toBe(15)
    expect(out.map((r) => r.turn)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
  })

  it('always includes the last 20 turns', () => {
    const rows: CheckpointRow[] = Array.from({ length: 200 }, (_, i) =>
      make(i + 1, 'assistant'),
    )
    const out = selectCheckpointsForReplay(rows)
    const lastTwenty = rows.slice(-20).map((r) => r.turn)
    for (const t of lastTwenty) {
      expect(out.some((r) => r.turn === t)).toBe(true)
    }
  })

  it('always includes every error event', () => {
    const rows: CheckpointRow[] = []
    for (let i = 1; i <= 150; i++) {
      rows.push(make(i, i === 40 || i === 75 ? 'error' : 'assistant'))
    }
    const out = selectCheckpointsForReplay(rows)
    expect(out.some((r) => r.turn === 40 && r.kind === 'error')).toBe(true)
    expect(out.some((r) => r.turn === 75 && r.kind === 'error')).toBe(true)
  })

  it('always includes Write and Edit tool_use summaries', () => {
    const rows: CheckpointRow[] = []
    for (let i = 1; i <= 120; i++) {
      if (i === 22) rows.push(make(i, 'tool_use', '[tool Write] /x (10 bytes)'))
      else if (i === 90) rows.push(make(i, 'tool_use', '[tool Edit] /y (3 bytes)'))
      else rows.push(make(i, 'assistant'))
    }
    const out = selectCheckpointsForReplay(rows)
    expect(out.some((r) => r.turn === 22)).toBe(true)
    expect(out.some((r) => r.turn === 90)).toBe(true)
  })

  it('caps at 50 total and preserves turn ordering', () => {
    const rows: CheckpointRow[] = []
    for (let i = 1; i <= 300; i++) {
      const kind = i % 7 === 0 ? 'error' : i % 11 === 0 ? 'tool_use' : 'assistant'
      const summary =
        kind === 'tool_use' && i % 33 === 0
          ? '[tool Write] /f (1 bytes)'
          : `turn ${i} ${kind}`
      rows.push(make(i, kind, summary))
    }
    const out = selectCheckpointsForReplay(rows)
    expect(out.length).toBeLessThanOrEqual(50)
    const turns = out.map((r) => r.turn)
    for (let i = 1; i < turns.length; i++) {
      expect(turns[i]).toBeGreaterThan(turns[i - 1]!)
    }
  })

  it('samples roughly one tool_use per 10-turn bucket outside the last 20', () => {
    const rows: CheckpointRow[] = []
    for (let i = 1; i <= 80; i++) {
      rows.push(make(i, i % 3 === 0 ? 'tool_use' : 'assistant'))
    }
    const out = selectCheckpointsForReplay(rows)
    const firstSixtyToolUses = out.filter((r) => r.turn <= 60 && r.kind === 'tool_use')
    expect(firstSixtyToolUses.length).toBeGreaterThanOrEqual(5)
    expect(firstSixtyToolUses.length).toBeLessThanOrEqual(8)
  })

  it('returns empty when given empty', () => {
    expect(selectCheckpointsForReplay([])).toEqual([])
  })

  it('preserves all errors even when over the cap (errors are critical)', () => {
    const rows: CheckpointRow[] = []
    for (let i = 1; i <= 200; i++) {
      // 10 errors scattered through the early portion
      if (i % 20 === 0 && i < 180) {
        rows.push(make(i, 'error', `[error] failure at ${i}`))
      } else {
        rows.push(make(i, 'assistant'))
      }
    }
    const out = selectCheckpointsForReplay(rows)
    const errors = out.filter((r) => r.kind === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(8) // most/all errors preserved
  })
})
