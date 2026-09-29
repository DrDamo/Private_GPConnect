import type { AdapterName, Fault, FaultControl } from '@pgpc/adapters'
import type { SqlClient } from './sql'

type Row = { adapter: AdapterName; kind: Fault['kind']; latency_ms: number | null }

const toFault = (r: Row): Fault => (r.kind === 'latency' ? { kind: 'latency', ms: r.latency_ms ?? 0 } : { kind: r.kind })

/**
 * Fault switches in Postgres, cached briefly so every adapter call doesn't
 * cost a query. A change takes effect everywhere within `ttlMs`.
 */
export class PostgresFaultSource implements FaultControl {
  private readonly sql: SqlClient
  private readonly ttlMs: number
  private cache: { at: number; faults: Partial<Record<AdapterName, Fault>> } | null = null

  constructor(sql: SqlClient, options: { ttlMs?: number } = {}) {
    this.sql = sql
    this.ttlMs = options.ttlMs ?? 2000
  }

  async all() {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.faults
    const rows = await this.sql.query<Row>('select adapter, kind, latency_ms from pgpc.sim_faults')
    const faults = Object.fromEntries(rows.map(r => [r.adapter, toFault(r)])) as Partial<Record<AdapterName, Fault>>
    this.cache = { at: Date.now(), faults }
    return faults
  }

  async get(adapter: AdapterName) {
    return (await this.all())[adapter] ?? null
  }

  async set(adapter: AdapterName, fault: Fault | null) {
    if (fault) {
      await this.sql.query(
        `insert into pgpc.sim_faults (adapter, kind, latency_ms, updated_at) values ($1, $2, $3, now())
         on conflict (adapter) do update set kind = excluded.kind, latency_ms = excluded.latency_ms, updated_at = now()`,
        [adapter, fault.kind, fault.kind === 'latency' ? fault.ms : null],
      )
    } else {
      await this.sql.query('delete from pgpc.sim_faults where adapter = $1', [adapter])
    }
    this.cache = null
  }
}
