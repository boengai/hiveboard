import type { Database } from 'bun:sqlite'
import { createTables } from './schema'
import { seed } from './seed'

export function migrate(db: Database): void {
  createTables(db)
  seed(db)
}
