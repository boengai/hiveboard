import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { generateId } from '../src/db/ulid'
import { loadVerificationFailures } from '../src/orchestrator/prespawn/load-verification-failures'
import { formatReviewComments } from '../src/orchestrator/prespawn/format-review-comments'
import { loadReviewComments } from '../src/orchestrator/prespawn/load-review-comments'
import { loadUndeliveredMessages } from '../src/orchestrator/prespawn/load-undelivered-messages'
import { loadPlaybookTools } from '../src/orchestrator/prespawn/load-playbook-tools'
import { loadRequiredSecrets } from '../src/orchestrator/prespawn/load-required-secrets'

describe('formatReviewComments', () => {
  it('returns just the header when there are no comments', () => {
    expect(formatReviewComments([])).toBe('## PR Review Comments')
  })

  it('renders author, path, line, body, and diff hunk for a single comment', () => {
    const out = formatReviewComments([
      {
        author: 'alice',
        path: 'src/foo.ts',
        line: 42,
        body: 'nit: rename',
        diffHunk: '@@ -1,2 +1,2 @@\n-old\n+new',
      },
    ])
    expect(out).toContain('alice')
    expect(out).toContain('src/foo.ts')
    expect(out).toContain('42')
    expect(out).toContain('nit: rename')
    expect(out).toContain('```diff')
    expect(out).toContain('-old')
  })

  it('omits the diff fence when diffHunk is null', () => {
    const out = formatReviewComments([
      { author: 'bob', path: null, line: null, body: 'lgtm', diffHunk: null },
    ])
    expect(out).not.toContain('```diff')
    expect(out).toContain('lgtm')
  })
})

describe('loadVerificationFailures', () => {
  let db: Database
  let taskId: string
  let runId: string

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    createTables(db)
    seed(db)
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as { id: string }
    const column = db
      .query('SELECT id FROM columns WHERE board_id = ? LIMIT 1')
      .get(board.id) as { id: string }
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string }
    taskId = generateId()
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, agent_status, created_by, updated_by)
       VALUES (?, ?, ?, 'T', '', 0, 'queued', ?, ?)`,
      [taskId, board.id, column.id, user.id, user.id],
    )
    runId = generateId()
    db.run(
      `INSERT INTO agent_runs (id, task_id, action, status) VALUES (?, ?, 'implement', 'failed')`,
      [runId, taskId],
    )
  })

  afterEach(() => db.close())

  it('returns empty failures + null clear-pointer when no pending pointer is set', () => {
    const out = loadVerificationFailures(db, taskId)
    expect(out.failures).toEqual([])
    expect(out.clearPendingAutoReviseFor).toBeNull()
  })

  it('returns failures + clear-pointer when pending pointer references a run with failing verification rows', () => {
    db.run(`UPDATE tasks SET pending_auto_revise_source_run_id = ? WHERE id = ?`, [
      runId,
      taskId,
    ])
    db.run(
      `INSERT INTO verification_runs (id, task_id, agent_run_id, label, command, exit_code, output, started_at, finished_at)
       VALUES (?, ?, ?, 'lint', 'bun run lint', 1, 'oops', datetime('now'), datetime('now'))`,
      [generateId(), taskId, runId],
    )
    const out = loadVerificationFailures(db, taskId)
    expect(out.clearPendingAutoReviseFor).toBe(taskId)
    expect(out.failures.length).toBe(1)
    expect(out.failures[0].label).toBe('lint')
    expect(out.failures[0].exit_code).toBe(1)
  })

  it('clears the pointer even when no failing runs are found', () => {
    db.run(`UPDATE tasks SET pending_auto_revise_source_run_id = ? WHERE id = ?`, [
      runId,
      taskId,
    ])
    const out = loadVerificationFailures(db, taskId)
    expect(out.failures).toEqual([])
    expect(out.clearPendingAutoReviseFor).toBe(taskId)
  })
})

describe('loadReviewComments', () => {
  const fakeGh = (
    comments: Array<{
      author: string
      path: string | null
      line: number | null
      body: string
      diffHunk: string | null
    }>,
  ) => ({
    fetchReviewComments: async () => comments,
  })

  it('returns undefined when action is not revise', async () => {
    const r = await loadReviewComments(
      { action: 'implement', prUrl: 'https://github.com/x/y/pull/1' },
      fakeGh([{ author: 'a', path: null, line: null, body: 'b', diffHunk: null }]),
    )
    expect(r).toBeUndefined()
  })

  it('returns undefined when prUrl is null', async () => {
    const r = await loadReviewComments(
      { action: 'revise', prUrl: null },
      fakeGh([]),
    )
    expect(r).toBeUndefined()
  })

  it('returns undefined when no comments are found', async () => {
    const r = await loadReviewComments(
      { action: 'revise', prUrl: 'https://github.com/x/y/pull/1' },
      fakeGh([]),
    )
    expect(r).toBeUndefined()
  })

  it('returns a formatted block when revise + prUrl + comments', async () => {
    const r = await loadReviewComments(
      { action: 'revise', prUrl: 'https://github.com/x/y/pull/1' },
      fakeGh([
        {
          author: 'alice',
          path: 'foo.ts',
          line: 1,
          body: 'nit',
          diffHunk: null,
        },
      ]),
    )
    expect(r).toContain('alice')
    expect(r).toContain('foo.ts')
  })

  it('returns undefined and swallows the error if the adapter throws', async () => {
    const r = await loadReviewComments(
      { action: 'revise', prUrl: 'https://github.com/x/y/pull/1' },
      {
        fetchReviewComments: async () => {
          throw new Error('network down')
        },
      },
    )
    expect(r).toBeUndefined()
  })
})

describe('loadUndeliveredMessages', () => {
  let db: Database
  let taskId: string

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    createTables(db)
    seed(db)
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as { id: string }
    const column = db
      .query('SELECT id FROM columns WHERE board_id = ? LIMIT 1')
      .get(board.id) as { id: string }
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string }
    taskId = generateId()
    // Mirror the INSERT shape used by the existing loadVerificationFailures tests
    // (it satisfies created_by/updated_by NOT NULL).
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, agent_status, created_by, updated_by)
       VALUES (?, ?, ?, 'T', '', 0, 'queued', ?, ?)`,
      [taskId, board.id, column.id, user.id, user.id],
    )
  })

  afterEach(() => db.close())

  it('returns no messages when none are undelivered', () => {
    const out = loadUndeliveredMessages(db, taskId)
    expect(out.messages).toEqual([])
    expect(out.deliveredMessageIds).toEqual([])
  })

  it('returns hint + redirect + answer; filters out question; ids match', () => {
    const ids = {
      hint: generateId(),
      redirect: generateId(),
      answer: generateId(),
      question: generateId(),
    }
    db.run(
      `INSERT INTO task_messages (id, task_id, author_type, kind, body) VALUES (?, ?, 'human', 'hint', 'h')`,
      [ids.hint, taskId],
    )
    db.run(
      `INSERT INTO task_messages (id, task_id, author_type, kind, body) VALUES (?, ?, 'human', 'redirect', 'r')`,
      [ids.redirect, taskId],
    )
    db.run(
      `INSERT INTO task_messages (id, task_id, author_type, kind, body) VALUES (?, ?, 'human', 'answer', 'a')`,
      [ids.answer, taskId],
    )
    db.run(
      `INSERT INTO task_messages (id, task_id, author_type, kind, body) VALUES (?, ?, 'human', 'question', 'q')`,
      [ids.question, taskId],
    )

    const out = loadUndeliveredMessages(db, taskId)
    expect(out.messages.map((m) => m.kind).sort()).toEqual(['answer', 'hint', 'redirect'])
    expect(out.deliveredMessageIds.sort()).toEqual(
      [ids.hint, ids.redirect, ids.answer].sort(),
    )
  })

  it('escapes Mustache delimiters in the body', () => {
    const id = generateId()
    db.run(
      `INSERT INTO task_messages (id, task_id, author_type, kind, body) VALUES (?, ?, 'human', 'hint', '{{ secret }}')`,
      [id, taskId],
    )
    const out = loadUndeliveredMessages(db, taskId)
    expect(out.messages[0].body).not.toContain('{{ secret }}')
  })
})

describe('loadPlaybookTools', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    createTables(db)
    seed(db)
  })

  afterEach(() => db.close())

  it('returns undefined when action is null', () => {
    expect(loadPlaybookTools(db, null)).toBeUndefined()
  })

  it('returns undefined when action is not a playbook', () => {
    expect(loadPlaybookTools(db, 'implement')).toBeUndefined()
  })

  it('returns undefined when the playbook does not exist', () => {
    expect(loadPlaybookTools(db, 'playbook:no-such-playbook')).toBeUndefined()
  })

  it('returns the current version override (string[] or null) when the playbook exists', () => {
    const r = loadPlaybookTools(db, 'playbook:bump-dep')
    // Seeded playbooks may have null or a list; both are valid. Never undefined.
    expect(r === null || Array.isArray(r)).toBe(true)
  })
})

describe('loadRequiredSecrets', () => {
  let db: Database
  let taskId: string
  let boardId: string

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    createTables(db)
    seed(db)
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as { id: string }
    boardId = board.id
    const column = db
      .query('SELECT id FROM columns WHERE board_id = ? LIMIT 1')
      .get(boardId) as { id: string }
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string }
    taskId = generateId()
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, agent_status, created_by, updated_by)
       VALUES (?, ?, ?, 'T', '', 0, 'queued', ?, ?)`,
      [taskId, boardId, column.id, user.id, user.id],
    )
  })

  afterEach(() => db.close())

  it('returns [] when the task declares no required secrets', () => {
    expect(loadRequiredSecrets(db, taskId)).toEqual([])
  })

  it('returns [] when the task does not exist', () => {
    expect(loadRequiredSecrets(db, 'no-such-task')).toEqual([])
  })

  it('pairs each declared name with its board-secret description (or null)', () => {
    db.run(`UPDATE tasks SET required_secrets = ? WHERE id = ?`, [
      JSON.stringify(['OPENAI_KEY', 'STRIPE_KEY']),
      taskId,
    ])
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string }
    db.run(
      `INSERT INTO board_secrets (id, board_id, name, description, encrypted_value, created_by)
       VALUES (?, ?, 'OPENAI_KEY', 'OpenAI key', x'00', ?)`,
      [generateId(), boardId, user.id],
    )
    const r = loadRequiredSecrets(db, taskId)
    const byName = Object.fromEntries(r.map((x) => [x.name, x.description]))
    expect(byName).toEqual({ OPENAI_KEY: 'OpenAI key', STRIPE_KEY: null })
  })
})
