import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { buildAgentEnv } from '../src/agent/env'
import { _setCheckpointSupportForTest } from '../src/agent/capability'
import { buildClaudeArgsForTest, type TaskForAgent } from '../src/agent/runner'
import { ConfigSchema } from '../src/config/schema'
import { createTables } from '../src/db/schema'
import { insertCheckpoint, listCheckpointsForRun } from '../src/db/checkpoints'
import { generateId } from '../src/db/ulid'
import { NDJSONLineParser } from '../src/agent/ndjson-line-parser'
import { summarizeEvent } from '../src/agent/summarize'

const TASK: TaskForAgent = {
  action: 'implement',
  agentInstruction: null,
  body: 'Test body',
  id: 'task-001',
  prUrl: null,
  targetBranch: 'main',
  targetRepo: 'org/repo',
  title: 'Test task',
}

const WORKSPACE = '/tmp/workspace'

const GIT_IDENTITY = { email: 'bot@example.com', name: 'Bot' }

describe('buildAgentEnv', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    // Set up a controlled host environment
    process.env.PATH = '/usr/bin'
    process.env.HOME = '/home/user'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    // Simulate leaked tokens in host env
    process.env.GITHUB_TOKEN = 'ghp_secret123'
    process.env.GH_TOKEN = 'gho_secret456'
    process.env.GITHUB_APP_ID = '12345'
    process.env.GITHUB_APP_PRIVATE_KEY = '-----BEGIN RSA-----'
    process.env.GITHUB_APP_INSTALLATION_ID = '67890'
  })

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key]
      }
    }
    Object.assign(process.env, savedEnv)
  })

  it('excludes GITHUB_TOKEN and related secrets', () => {
    const env = buildAgentEnv(TASK, WORKSPACE)

    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.GH_TOKEN).toBeUndefined()
    expect(env.GITHUB_APP_ID).toBeUndefined()
    expect(env.GITHUB_APP_PRIVATE_KEY).toBeUndefined()
    expect(env.GITHUB_APP_INSTALLATION_ID).toBeUndefined()
  })

  it('includes allowed host env vars', () => {
    const env = buildAgentEnv(TASK, WORKSPACE)

    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/user')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test')
  })

  it('includes task-specific vars', () => {
    const env = buildAgentEnv(TASK, WORKSPACE)

    expect(env.HIVEBOARD_TASK_ID).toBe('task-001')
    expect(env.HIVEBOARD_TASK_TITLE).toBe('Test task')
    expect(env.HIVEBOARD_WORKSPACE).toBe('/tmp/workspace')
  })

  it('includes git identity when provided', () => {
    const env = buildAgentEnv(TASK, WORKSPACE, GIT_IDENTITY)

    expect(env.GIT_AUTHOR_NAME).toBe('Bot')
    expect(env.GIT_AUTHOR_EMAIL).toBe('bot@example.com')
    expect(env.GIT_COMMITTER_NAME).toBe('Bot')
    expect(env.GIT_COMMITTER_EMAIL).toBe('bot@example.com')
  })

  it('omits git identity when not provided', () => {
    const env = buildAgentEnv(TASK, WORKSPACE)

    expect(env.GIT_AUTHOR_NAME).toBeUndefined()
    expect(env.GIT_AUTHOR_EMAIL).toBeUndefined()
    expect(env.GIT_COMMITTER_NAME).toBeUndefined()
    expect(env.GIT_COMMITTER_EMAIL).toBeUndefined()
  })

  it('does not leak arbitrary host env vars', () => {
    process.env.MY_SECRET_KEY = 'supersecret'
    process.env.DATABASE_URL = 'postgres://...'

    const env = buildAgentEnv(TASK, WORKSPACE)

    expect(env.MY_SECRET_KEY).toBeUndefined()
    expect(env.DATABASE_URL).toBeUndefined()
  })

  it('omits allowed vars that are not set on the host', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK

    const env = buildAgentEnv(TASK, WORKSPACE)

    expect('CLAUDE_CODE_USE_BEDROCK' in env).toBe(false)
  })
})

describe('HIVEBOARD_SCRATCHPAD env var', () => {
  const VALID_ULID = '01HYX3KPQR000000000000000A'
  const ULID_TASK: TaskForAgent = { ...TASK, id: VALID_ULID }
  const testConfig = ConfigSchema.parse({
    agent: { state_root: '/tmp/hb-state' },
  })

  it('is defined when config is passed', () => {
    const env = buildAgentEnv(
      ULID_TASK,
      WORKSPACE,
      undefined,
      undefined,
      testConfig,
    )
    expect(env.HIVEBOARD_SCRATCHPAD).toBeDefined()
    expect(
      env.HIVEBOARD_SCRATCHPAD?.endsWith(`/${VALID_ULID}/scratchpad.md`),
    ).toBe(true)
  })

  it('is undefined when config is omitted', () => {
    const env = buildAgentEnv(ULID_TASK, WORKSPACE)
    expect(env.HIVEBOARD_SCRATCHPAD).toBeUndefined()
  })

  it('is undefined for a non-ULID task id (skipped silently)', () => {
    const env = buildAgentEnv(TASK, WORKSPACE, undefined, undefined, testConfig)
    expect(env.HIVEBOARD_SCRATCHPAD).toBeUndefined()
  })
})

describe('HIVEBOARD_PROGRESS env var', () => {
  const VALID_ULID = '01HYX3KPQR000000000000000A'
  const ULID_TASK: TaskForAgent = { ...TASK, id: VALID_ULID }
  const testConfig = ConfigSchema.parse({
    agent: { state_root: '/tmp/hb-state' },
  })

  it('points at {agent.state_root}/{task-id}/progress.ndjson', () => {
    const env = buildAgentEnv(
      ULID_TASK,
      WORKSPACE,
      undefined,
      undefined,
      testConfig,
    )
    expect(env.HIVEBOARD_PROGRESS).toBeDefined()
    expect(
      env.HIVEBOARD_PROGRESS?.endsWith(
        '/01HYX3KPQR000000000000000A/progress.ndjson',
      ),
    ).toBe(true)
  })

  it('is skipped silently for non-ULID task ids', () => {
    const env = buildAgentEnv(TASK, WORKSPACE, undefined, undefined, testConfig)
    expect(env.HIVEBOARD_PROGRESS).toBeUndefined()
  })
})

describe('buildClaudeArgs with checkpoint capture', () => {
  const MIN_CONFIG = ConfigSchema.parse({
    claude: {
      allowed_tools: ['Bash'],
      command: 'claude',
      max_turns: 10,
      model: 'opus',
    },
  })

  afterEach(() => {
    _setCheckpointSupportForTest(undefined)
  })

  it('uses stream-json + --verbose when checkpoints are supported', () => {
    _setCheckpointSupportForTest(true)
    const args = buildClaudeArgsForTest(MIN_CONFIG, 'hello', null)
    const fmtIdx = args.indexOf('--output-format')
    expect(fmtIdx).toBeGreaterThan(-1)
    expect(args[fmtIdx + 1]).toBe('stream-json')
    expect(args).toContain('--verbose')
  })

  it('falls back to json (no --verbose) when checkpoints are unsupported', () => {
    _setCheckpointSupportForTest(false)
    const args = buildClaudeArgsForTest(MIN_CONFIG, 'hello', null)
    const fmtIdx = args.indexOf('--output-format')
    expect(fmtIdx).toBeGreaterThan(-1)
    expect(args[fmtIdx + 1]).toBe('json')
    expect(args).not.toContain('--verbose')
  })
})

describe('checkpoint capture: parser feed → DB insert', () => {
  // Tests the composition: NDJSONLineParser feed → summarizeEvent → insertCheckpoint.
  // Does NOT go through runAgent (which is module-mocked in orchestrator tests);
  // this directly exercises the closure that runAgent wires up.
  let db: Database
  const VALID_ULID = '01HYX3KPQR000000000000000A'
  const AGENT_RUN_ID = 'run-e2e-1'

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    createTables(db)
    db.run(
      `INSERT INTO users (id, username, display_name)
       VALUES ('sys', 'sys', 'System')`,
    )
    db.run(
      `INSERT INTO boards (id, name, created_by)
       VALUES ('b1', 'B', 'sys')`,
    )
    db.run(
      `INSERT INTO columns (id, board_id, name, position)
       VALUES ('c1', 'b1', 'Todo', 0)`,
    )
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, created_by, updated_by)
       VALUES (?, 'b1', 'c1', 't', '', 0, 'sys', 'sys')`,
      [VALID_ULID],
    )
    db.run(
      `INSERT INTO agent_runs (id, task_id, action, status)
       VALUES (?, ?, 'implement', 'queued')`,
      [AGENT_RUN_ID, VALID_ULID],
    )
  })

  it('feeds NDJSON through the summarizer and inserts checkpoint rows', () => {
    const events = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: '/a/b.txt' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'x',
              name: 'Read',
              is_error: false,
              content: 'file content here',
            },
          ],
        },
      }),
    ]

    let turn = 0
    const parser = new NDJSONLineParser((evt, meta) => {
      turn += 1
      const cp = summarizeEvent(evt, turn, { rawBytes: meta.rawBytes })
      if (!cp) return
      insertCheckpoint(db, {
        agentRunId: AGENT_RUN_ID,
        id: generateId(),
        kind: cp.kind,
        rawBytes: cp.rawBytes,
        summary: cp.summary,
        turn: cp.turn,
      })
    })

    // Feed all events as a single NDJSON chunk (newline-separated).
    parser.feed(events.join('\n') + '\n')
    parser.flush()

    const rows = listCheckpointsForRun(db, AGENT_RUN_ID)
    expect(rows.length).toBe(3)
    expect(rows[0].kind).toBe('assistant')
    expect(rows[0].summary).toContain('hello')
    expect(rows[1].kind).toBe('tool_use')
    expect(rows[1].summary).toContain('[tool Read] /a/b.txt')
    expect(rows[2].kind).toBe('tool_result')
    expect(rows[2].summary).toContain('[result for Read]')
    expect(rows[2].summary).not.toContain('file content here')
    // Turns should be sequential.
    expect(rows.map((r) => r.turn)).toEqual([1, 2, 3])
  })
})
