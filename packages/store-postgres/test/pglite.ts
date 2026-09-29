import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { SqlClient } from '../src'

const migrationsDir = new URL('../../../supabase/migrations/', import.meta.url)

function wrap(db: Pick<PGlite, 'query'>, transaction?: PGlite['transaction']): SqlClient {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await db.query<T>(text, params)).rows
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>) {
      if (!transaction) return fn(this)
      return transaction(tx => fn(wrap(tx)))
    },
  }
}

// Booting PGlite and running migrations takes seconds, so do it once per test
// file and hand each test a cheap clone.
let template: Promise<PGlite> | undefined

async function migratedTemplate(): Promise<PGlite> {
  const db = await PGlite.create()
  for (const file of readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(file, migrationsDir), 'utf8'))
  }
  return db
}

/** A fresh in-process Postgres with every migration applied. */
export async function freshDatabase(): Promise<{ db: PGlite; sql: SqlClient }> {
  template ??= migratedTemplate()
  const db = (await (await template).clone()) as PGlite
  return { db, sql: wrap(db, db.transaction.bind(db)) }
}

/**
 * Binds parameters the way postgres.js does in production: a value bound
 * directly to a `$n::jsonb` placeholder is JSON-encoded by the driver. PGlite
 * passes it through, which hid a double-encoding bug; run stores through this
 * so they must bind jsonb as text (`$n::text::jsonb`).
 */
export function withPostgresJsBinding(sql: SqlClient): SqlClient {
  return {
    query<T>(text: string, params: unknown[] = []) {
      const encoded = [...params]
      for (const [, n] of text.matchAll(/\$(\d+)::jsonb/g)) encoded[Number(n) - 1] = JSON.stringify(params[Number(n) - 1])
      return sql.query<T>(text, encoded)
    },
    transaction<T>(fn: (tx: SqlClient) => Promise<T>) {
      return sql.transaction(tx => fn(withPostgresJsBinding(tx)))
    },
  }
}
