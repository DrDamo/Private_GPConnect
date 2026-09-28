import postgres from 'postgres'

/** Minimal SQL surface the stores need, so they run on postgres.js or PGlite. */
export interface SqlClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>
}

type PgJs = postgres.Sql | postgres.TransactionSql

function wrap(sql: PgJs, begin?: postgres.Sql['begin']): SqlClient {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[]
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>) {
      if (!begin) return fn(this) // already inside a transaction
      return (await begin(tx => fn(wrap(tx)))) as T
    },
  }
}

export interface PostgresClient extends SqlClient {
  close(): Promise<void>
}

/**
 * Connects with settings suited to serverless functions behind Supabase's
 * transaction-mode pooler (port 6543): no prepared statements, one connection.
 */
export function createPostgresClient(url: string): PostgresClient {
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, ssl: 'require' })
  return { ...wrap(sql, sql.begin.bind(sql)), close: () => sql.end({ timeout: 5 }) }
}
