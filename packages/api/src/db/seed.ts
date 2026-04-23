import type { Database } from 'bun:sqlite'
import { generateId } from './ulid'

const SEEDED_PLAYBOOKS: Array<{
  name: string
  displayName: string
  description: string
  promptTemplate: string
  defaults: Record<string, unknown>
  allowedToolsOverride: string[] | null
}> = [
  {
    allowedToolsOverride: null,
    defaults: { verify_commands: ['test', 'tsc'] },
    description: 'Bump a dependency (or set) and fix breakages caused by the bump.',
    displayName: 'Bump dependency',
    name: 'bump-dep',
    promptTemplate: [
      'Target dependency: {{ task.agent_instruction }}',
      '',
      'Bump to the latest compatible version. Run the project tests; fix any',
      'breakages caused by the bump. If type changes cascade, update call sites.',
      'Commit in logical chunks: one for the bump, one per breakage category.',
      'Open a PR targeting {{ task.target_branch }}.',
    ].join('\n'),
  },
  {
    allowedToolsOverride: null,
    defaults: { tags: ['tests'] },
    description: 'Add missing tests for a file or directory.',
    displayName: 'Add tests',
    name: 'add-tests',
    promptTemplate: [
      'Target: {{ task.agent_instruction }}',
      '',
      'Read the target code. Identify untested branches. Add tests in the',
      "project's existing test style. Do not change production code unless",
      'necessary to make it testable; if you must, keep changes minimal.',
      'Verify all tests pass before opening a PR.',
    ].join('\n'),
  },
  {
    allowedToolsOverride: null,
    defaults: { tags: ['flake'], time_box_ms: 1_800_000 },
    description: 'Investigate a flaky test.',
    displayName: 'Triage flake',
    name: 'triage-flake',
    promptTemplate: [
      'Target test: {{ task.agent_instruction }}',
      '',
      'Run the test 10 times. Record pass/fail counts. If all pass, write a',
      'note to the scratchpad saying "could not reproduce" and exit without',
      'PR. If it fails intermittently, analyze the failure pattern — order',
      'dependency, timing, environment, data setup. Propose a root-cause',
      'hypothesis. If confident, implement the fix. If not, use',
      '`$HIVEBOARD_QUESTION` to ask the human.',
    ].join('\n'),
  },
  {
    allowedToolsOverride: ['Bash', 'Read', 'Grep', 'Glob'],
    defaults: {},
    description: 'Read-only security review of a PR.',
    displayName: 'Security review',
    name: 'security-review',
    promptTemplate: [
      'Target PR: {{ task.pr_url }}',
      '',
      'Read the diff. Check for: OWASP top 10 vulnerabilities, hard-coded',
      'secrets, missing authorization, input validation gaps, unsafe',
      'deserialization, SQL injection, XSS. For each finding, cite file:line',
      'and describe the attack. Do NOT modify code; your output is a review.',
      'Post findings as PR review comments using `gh pr review`.',
    ].join('\n'),
  },
]

export function seed(db: Database): void {
  const existingUser = db
    .query('SELECT id FROM users WHERE username = ?')
    .get('queen-bee') as { id: string } | null

  let userId: string
  if (existingUser) {
    userId = existingUser.id
  } else {
    userId = generateId()
    const boardId = generateId()
    db.exec('BEGIN')
    try {
      db.run(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)',
        [userId, 'queen-bee', 'Queen Bee', 'super-admin'],
      )
      db.run('INSERT INTO boards (id, name, created_by) VALUES (?, ?, ?)', [
        boardId,
        'HiveBoard',
        userId,
      ])
      const columns = ['Backlog', 'Todo', 'In Progress', 'Review', 'Done']
      for (let i = 0; i < columns.length; i++) {
        db.run(
          'INSERT INTO columns (id, board_id, name, position) VALUES (?, ?, ?, ?)',
          [generateId(), boardId, columns[i] as string, i],
        )
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }

  seedPlaybooks(db, userId)
}

function seedPlaybooks(db: Database, userId: string): void {
  for (const pb of SEEDED_PLAYBOOKS) {
    const existing = db
      .query('SELECT id FROM playbooks WHERE name = ?')
      .get(pb.name) as { id: string } | null
    if (existing) continue

    const playbookId = generateId()
    const versionId = generateId()

    db.exec('BEGIN')
    try {
      db.run(
        `INSERT INTO playbooks (id, name, display_name, description) VALUES (?, ?, ?, ?)`,
        [playbookId, pb.name, pb.displayName, pb.description],
      )
      db.run(
        `INSERT INTO playbook_versions
           (id, playbook_id, version_number, prompt_template, defaults_json, allowed_tools_override, created_by)
         VALUES (?, ?, 1, ?, ?, ?, ?)`,
        [
          versionId,
          playbookId,
          pb.promptTemplate,
          JSON.stringify(pb.defaults),
          pb.allowedToolsOverride
            ? JSON.stringify(pb.allowedToolsOverride)
            : null,
          userId,
        ],
      )
      db.run(`UPDATE playbooks SET current_version_id = ? WHERE id = ?`, [
        versionId,
        playbookId,
      ])
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}
