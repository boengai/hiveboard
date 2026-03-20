import { Database } from 'bun:sqlite'
import path from 'node:path'
import { mkdirSync } from 'node:fs'

const dbPath = process.env.DATABASE_PATH ?? path.join(import.meta.dir, '../../../../tmp/database/hiveboard.db')

mkdirSync(path.dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
