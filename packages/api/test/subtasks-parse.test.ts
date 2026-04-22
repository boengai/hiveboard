import { describe, expect, it } from 'bun:test'
import { parseSubtasksManifest } from '../src/orchestrator/subtasks'

const YAML_VALID = `
subtasks:
  - title: "First"
    action: implement
  - title: "Second"
    depends_on_siblings: [0]
`

describe('parseSubtasksManifest', () => {
  it('parses a valid manifest', () => {
    const result = parseSubtasksManifest(YAML_VALID)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.manifest.subtasks).toHaveLength(2)
      expect(result.manifest.subtasks[0].title).toBe('First')
      expect(result.manifest.subtasks[1].depends_on_siblings).toEqual([0])
    }
  })

  it('rejects >20 subtasks', () => {
    const many =
      'subtasks:\n' +
      Array.from({ length: 21 })
        .map((_, i) => `  - title: "T${i}"`)
        .join('\n')
    const result = parseSubtasksManifest(many)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      const codes = result.errors.map((e) => e.code)
      expect(codes).toContain('TOO_MANY_SUBTASKS')
    }
  })

  it('rejects missing title', () => {
    const bad = 'subtasks:\n  - action: implement\n'
    const result = parseSubtasksManifest(bad)
    expect(result.kind).toBe('error')
  })

  it('rejects invalid action', () => {
    const bad = 'subtasks:\n  - title: "x"\n    action: wat\n'
    const result = parseSubtasksManifest(bad)
    expect(result.kind).toBe('error')
  })

  it('rejects out-of-range depends_on_siblings', () => {
    const bad = 'subtasks:\n  - title: "one"\n    depends_on_siblings: [5]\n'
    const result = parseSubtasksManifest(bad)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(
        result.errors.some((e) => e.code === 'DEP_INDEX_OUT_OF_RANGE'),
      ).toBe(true)
    }
  })

  it('rejects malformed YAML', () => {
    const bad = 'subtasks:\n  - title: [unterminated'
    const result = parseSubtasksManifest(bad)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.errors.some((e) => e.code === 'YAML_PARSE')).toBe(true)
    }
  })

  it('rejects when root shape is wrong (no subtasks key)', () => {
    const bad = 'nope: []\n'
    const result = parseSubtasksManifest(bad)
    expect(result.kind).toBe('error')
  })

  it('rejects depends_on_siblings referencing a later sibling (would enable cycles)', () => {
    // A mutual [A→B, B→A] manifest used to parse OK because d !== i held
    // for both. Now we enforce d < i so siblings can only depend on
    // earlier entries in the array, making cycles impossible.
    const bad = `subtasks:
  - title: "A"
    depends_on_siblings: [1]
  - title: "B"
    depends_on_siblings: [0]
`
    const result = parseSubtasksManifest(bad)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(
        result.errors.some((e) => e.code === 'DEP_INDEX_OUT_OF_RANGE'),
      ).toBe(true)
    }
  })

  it('rejects self-reference in depends_on_siblings', () => {
    const bad = `subtasks:
  - title: "A"
    depends_on_siblings: [0]
`
    const result = parseSubtasksManifest(bad)
    expect(result.kind).toBe('error')
  })
})
