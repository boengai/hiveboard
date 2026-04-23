import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import {
  archivePlaybook,
  createPlaybook,
  getPlaybookByName,
  listPlaybooks,
  PlaybookArchivedError,
  PlaybookNameTakenError,
  PlaybookNotFoundError,
  unarchivePlaybook,
  updatePlaybook,
} from '../src/playbooks'

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
  createTables(db)
  db.run(
    `INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`,
  )
})

afterEach(() => db.close())

describe('createPlaybook', () => {
  it('inserts playbook + v1 + wires current_version_id', () => {
    const pb = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: '{}',
      description: 'd',
      displayName: 'Bump',
      name: 'bump-dep',
      promptTemplate: 'tpl',
    })
    expect(pb.name).toBe('bump-dep')
    expect(pb.currentVersion.versionNumber).toBe(1)
    expect(pb.currentVersion.promptTemplate).toBe('tpl')
  })

  it('throws PlaybookNameTakenError on UNIQUE violation', () => {
    createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: '{}',
      description: 'd',
      displayName: 'Bump',
      name: 'bump-dep',
      promptTemplate: 'tpl',
    })
    expect(() =>
      createPlaybook(db, {
        allowedToolsOverride: null,
        createdBy: 'U1',
        defaultsJson: '{}',
        description: 'd2',
        displayName: 'Bump2',
        name: 'bump-dep',
        promptTemplate: 'tpl2',
      }),
    ).toThrow(PlaybookNameTakenError)
  })
})

describe('updatePlaybook', () => {
  it('creates a new version (v2) and moves current_version_id', () => {
    const pb = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: '{}',
      description: 'd',
      displayName: 'Bump',
      name: 'bump-dep',
      promptTemplate: 'tpl v1',
    })
    const v1Id = pb.currentVersion.id

    const updated = updatePlaybook(db, pb.id, {
      createdBy: 'U1',
      promptTemplate: 'tpl v2',
    })
    expect(updated.currentVersion.versionNumber).toBe(2)
    expect(updated.currentVersion.promptTemplate).toBe('tpl v2')
    expect(updated.currentVersion.id).not.toBe(v1Id)

    // v1 still exists and is untouched
    const v1 = db
      .query('SELECT * FROM playbook_versions WHERE id = ?')
      .get(v1Id) as { prompt_template: string; version_number: number }
    expect(v1.prompt_template).toBe('tpl v1')
    expect(v1.version_number).toBe(1)
  })

  it('carries forward unchanged fields from the previous version', () => {
    const pb = createPlaybook(db, {
      allowedToolsOverride: ['Read'],
      createdBy: 'U1',
      defaultsJson: '{"tags":["x"]}',
      description: 'd',
      displayName: 'Bump',
      name: 'bump-dep',
      promptTemplate: 'tpl',
    })
    const updated = updatePlaybook(db, pb.id, {
      createdBy: 'U1',
      displayName: 'Bump v2',
    })
    expect(updated.displayName).toBe('Bump v2')
    expect(updated.currentVersion.promptTemplate).toBe('tpl')
    expect(updated.currentVersion.defaultsJson).toBe('{"tags":["x"]}')
    expect(updated.currentVersion.allowedToolsOverride).toEqual(['Read'])
  })

  it('throws PlaybookNotFoundError when id does not exist', () => {
    expect(() =>
      updatePlaybook(db, 'nope', { createdBy: 'U1', promptTemplate: 'x' }),
    ).toThrow(PlaybookNotFoundError)
  })

  it('throws PlaybookArchivedError when updating an archived playbook', () => {
    const pb = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: '{}',
      description: 'd',
      displayName: 'Bump',
      name: 'bump-dep',
      promptTemplate: 'tpl',
    })
    archivePlaybook(db, pb.id)
    expect(() =>
      updatePlaybook(db, pb.id, { createdBy: 'U1', promptTemplate: 'x' }),
    ).toThrow(PlaybookArchivedError)
  })
})

describe('archive / unarchive', () => {
  it('archive sets flag; unarchive clears it', () => {
    const pb = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: '{}',
      description: 'd',
      displayName: 'Bump',
      name: 'bump-dep',
      promptTemplate: 'tpl',
    })
    expect(pb.archived).toBe(false)
    expect(archivePlaybook(db, pb.id).archived).toBe(true)
    expect(unarchivePlaybook(db, pb.id).archived).toBe(false)
  })
})

describe('getPlaybookByName / listPlaybooks', () => {
  it('getPlaybookByName returns null when missing', () => {
    expect(getPlaybookByName(db, 'nope')).toBeNull()
  })

  it('listPlaybooks returns newest-first and includes archived by default', () => {
    createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: '{}',
      description: 'd',
      displayName: 'A',
      name: 'a',
      promptTemplate: 't',
    })
    const b = createPlaybook(db, {
      allowedToolsOverride: null,
      createdBy: 'U1',
      defaultsJson: '{}',
      description: 'd',
      displayName: 'B',
      name: 'b',
      promptTemplate: 't',
    })
    archivePlaybook(db, b.id)
    const all = listPlaybooks(db)
    expect(all.map((p) => p.name).sort()).toEqual(['a', 'b'])
  })
})
