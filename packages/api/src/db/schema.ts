import type { Database } from 'bun:sqlite'

export function createTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      username        TEXT NOT NULL UNIQUE,
      display_name    TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'member',
      github_id       TEXT UNIQUE,
      github_username TEXT,
      revoked_at      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id               TEXT PRIMARY KEY,
      token            TEXT NOT NULL UNIQUE,
      github_username  TEXT NOT NULL,
      created_by       TEXT NOT NULL REFERENCES users(id),
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at       TEXT NOT NULL,
      used_at          TEXT,
      used_by_github_id TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      token      TEXT NOT NULL UNIQUE,
      user_id    TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS boards (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS columns (
      id         TEXT PRIMARY KEY,
      board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      position   INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id             TEXT PRIMARY KEY,
      board_id       TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      column_id      TEXT NOT NULL REFERENCES columns(id),
      title          TEXT NOT NULL,
      body           TEXT NOT NULL DEFAULT '',
      position       REAL NOT NULL DEFAULT 0,
      action              TEXT,
      agent_instruction   TEXT,
      target_repo         TEXT,
      target_branch  TEXT DEFAULT 'main',
      agent_status   TEXT NOT NULL DEFAULT 'idle',
      queue_after    TEXT,
      agent_output   TEXT,
      agent_error    TEXT,
      retry_count    INTEGER NOT NULL DEFAULT 0,
      pr_url         TEXT,
      archived       INTEGER NOT NULL DEFAULT 0,
      archived_at    TEXT,
      created_by     TEXT NOT NULL REFERENCES users(id),
      updated_by     TEXT NOT NULL REFERENCES users(id),
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      parent_id  TEXT REFERENCES task_comments(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      actor      TEXT NOT NULL,
      type       TEXT NOT NULL,
      data       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      action      TEXT NOT NULL,
      status      TEXT NOT NULL,
      output      TEXT,
      error       TEXT,
      started_at  TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id         TEXT PRIMARY KEY,
      board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT 'default',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(board_id, name)
    );

    CREATE TABLE IF NOT EXISTS task_tags (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_board_column ON tasks(board_id, column_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_agent_status ON tasks(agent_status);
    CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_tags_board ON tags(board_id);
    CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    -- Migrate legacy 'idle' action values to NULL
    UPDATE tasks SET action = NULL WHERE action = 'idle';
  `)
}
