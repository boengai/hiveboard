import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const dbPath =
  process.env.DATABASE_PATH ??
  path.join(process.cwd(), 'tmp/database/hiveboard.db')

mkdirSync(path.dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
