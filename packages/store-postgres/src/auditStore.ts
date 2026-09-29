import type { AuditEvent, AuditQuery, AuditStore, ChainTail } from '@pgpc/core'
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

  async list(query: AuditQuery) {
    const where: string[] = []
    const params: unknown[] = []
    const add = (sql: string, value: unknown) => {
      params.push(value)
      where.push(sql.replace('?', `$${params.length}`))
    }
    if (query.afterSeq !== undefined) add('seq > ?', query.afterSeq)
    if (query.beforeSeq !== undefined) add('seq < ?', query.beforeSeq)
    if (query.patientRef !== undefined) add('patient_ref = ?', query.patientRef)
    if (query.consentId !== undefined) add('consent_id = ?', query.consentId)
    if (query.outcome !== undefined) add('outcome = ?', query.outcome)
    if (query.type !== undefined) {
      if (query.type.endsWith('.')) add("type like ? || '%'", query.type.replace(/[%_\\]/g, m => `\\${m}`))
      else add('type = ?', query.type)
    }
    params.push(query.limit)
    const rows = await this.sql.query<Row>(
      `select event from pgpc.audit_events ${where.length ? `where ${where.join(' and ')}` : ''}
        order by seq ${query.order === 'desc' ? 'desc' : 'asc'} limit $${params.length}`,
      params,
    )
    return rows.map(r => r.event)
  }
}
