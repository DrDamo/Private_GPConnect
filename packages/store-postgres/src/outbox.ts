import type { OutboxMessage, SimOutbox } from '@pgpc/adapters'
import type { SqlClient } from './sql'

type Row = { id: string; sent_at: Date | string; to_number: string; body: string; reference: string | null }

export class PostgresOutbox implements SimOutbox {
  private readonly sql: SqlClient
  constructor(sql: SqlClient) {
    this.sql = sql
  }

  async add(m: OutboxMessage) {
    await this.sql.query(
      'insert into pgpc.sim_sms_outbox (id, sent_at, to_number, body, reference) values ($1, $2, $3, $4, $5)',
      [m.id, m.sentAt, m.to, m.body, m.reference ?? null],
    )
  }

  async list(query: { to?: string; limit: number }) {
    const rows = query.to
      ? await this.sql.query<Row>(
          'select * from pgpc.sim_sms_outbox where to_number = $1 order by sent_at desc, id limit $2',
          [query.to, query.limit],
        )
      : await this.sql.query<Row>('select * from pgpc.sim_sms_outbox order by sent_at desc, id limit $1', [query.limit])
    return rows.map(r => ({
      id: r.id,
      sentAt: new Date(r.sent_at).toISOString(),
      to: r.to_number,
      body: r.body,
      ...(r.reference ? { reference: r.reference } : {}),
    }))
  }
}
