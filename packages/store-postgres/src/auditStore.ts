import type { AuditEvent, AuditStore, ChainTail } from '@pgpc/core'
import type { SqlClient } from './sql'

// Serialises appends across all server instances with a transaction-scoped
// advisory lock, so the chain can never fork. The lock is released on commit.
const APPEND_LOCK_KEY = 7_303_001

type Row = { event: AuditEvent }

export class PostgresAuditStore implements AuditStore {
  private readonly sql: SqlClient
  constructor(sql: SqlClient) {
    this.sql = sql
  }

  append(build: (tail: ChainTail | null) => AuditEvent): Promise<AuditEvent> {
    return this.sql.transaction(async tx => {
      await tx.query('select pg_advisory_xact_lock($1)', [APPEND_LOCK_KEY])
      const [last] = await tx.query<Row>('select event from pgpc.audit_events order by seq desc limit 1')
      const event = build(last ? { seq: last.event.seq, hash: last.event.hash } : null)
      await tx.query(
        `insert into pgpc.audit_events
           (seq, id, recorded_at, type, outcome, patient_ref, consent_id, correlation_id, prev_hash, hash, event)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [
          event.seq,
          event.id,
          event.recordedAt,
          event.type,
          event.outcome,
          event.patientRef ?? null,
          event.consentId ?? null,
          event.correlationId,
          event.prevHash,
          event.hash,
          JSON.stringify(event),
        ],
      )
      return event
    })
  }

  async list(query: { afterSeq?: number; limit: number; patientRef?: string; consentId?: string }) {
    const where = ['seq > $1']
    const params: unknown[] = [query.afterSeq ?? 0]
    if (query.patientRef !== undefined) {
      params.push(query.patientRef)
      where.push(`patient_ref = $${params.length}`)
    }
    if (query.consentId !== undefined) {
      params.push(query.consentId)
      where.push(`consent_id = $${params.length}`)
    }
    params.push(query.limit)
    const rows = await this.sql.query<Row>(
      `select event from pgpc.audit_events where ${where.join(' and ')} order by seq limit $${params.length}`,
      params,
    )
    return rows.map(r => r.event)
  }
}
