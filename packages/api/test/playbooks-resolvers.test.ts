import { describe, expect, it } from 'bun:test'
import {
  PLAYBOOK_NAME_REGEX,
  validatePlaybookInput,
  VALID_TOOL_NAMES,
} from '../src/schema/validation'

describe('playbook name regex', () => {
  const pass = ['bump-dep', 'add-tests', 'foo', 'a1-b2-c3', 'triage-flake']
  const fail = [
    'Bump-Dep', // uppercase
    '-leading',
    'trailing-',
    'double--hyphen',
    '',
    'has space',
    'playbook:foo', // reserved prefix
    'foo:bar', // colons not allowed
  ]
  for (const name of pass) {
    it(`accepts ${name}`, () => {
      expect(PLAYBOOK_NAME_REGEX.test(name)).toBe(true)
    })
  }
  for (const name of fail) {
    it(`rejects ${name}`, () => {
      // regex rejects the simple shape; validatePlaybookInput rejects the reserved prefix separately.
      const regexOK = PLAYBOOK_NAME_REGEX.test(name)
      const wouldThrow = (() => {
        try {
          validatePlaybookInput({
            allowedToolsOverride: null,
            defaultsJson: '{}',
            description: 'd',
            displayName: 'd',
            name,
            promptTemplate: 't',
          })
          return false
        } catch {
          return true
        }
      })()
      expect(regexOK && !wouldThrow).toBe(false)
    })
  }
})

describe('validatePlaybookInput — allowed tools', () => {
  it('accepts known tools', () => {
    expect(() =>
      validatePlaybookInput({
        allowedToolsOverride: ['Bash', 'Read'],
        defaultsJson: '{}',
        description: 'd',
        displayName: 'd',
        name: 'ok',
        promptTemplate: 't',
      }),
    ).not.toThrow()
  })

  it('rejects unknown tools', () => {
    expect(() =>
      validatePlaybookInput({
        allowedToolsOverride: ['LaunchNukes'],
        defaultsJson: '{}',
        description: 'd',
        displayName: 'd',
        name: 'ok',
        promptTemplate: 't',
      }),
    ).toThrow(/Unknown tool/)
  })

  it('rejects malformed Mustache template', () => {
    expect(() =>
      validatePlaybookInput({
        allowedToolsOverride: null,
        defaultsJson: '{}',
        description: 'd',
        displayName: 'd',
        name: 'ok',
        promptTemplate: 'hello {{ unclosed',
      }),
    ).toThrow(/Mustache/)
  })

  it('rejects invalid defaults JSON', () => {
    expect(() =>
      validatePlaybookInput({
        allowedToolsOverride: null,
        defaultsJson: 'not-json',
        description: 'd',
        displayName: 'd',
        name: 'ok',
        promptTemplate: 't',
      }),
    ).toThrow(/defaultsJson/)
  })
})

describe('VALID_TOOL_NAMES', () => {
  it('contains the default WORKFLOW.md tool list', () => {
    for (const t of ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']) {
      expect(VALID_TOOL_NAMES.has(t)).toBe(true)
    }
  })
})
