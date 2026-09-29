import { ConcurrentModificationError, type ConsentRecord, type ConsentRepository, type ConsentStatus } from '@pgpc/core'
import type { SqlClient } from './sql'

type Row = { record: ConsentRecord }

export class PostgresConsentRepository implements ConsentRepository {
  private readonly sql: SqlClient
  constructor(sql: SqlClient) {
    this.sql = sql
  }

  async get(id: string) {
    const rows = await this.sql.query<Row>('select record from pgpc.consents where id = $1', [id])
    return rows[0]?.record ?? null
  }

  async insert(r: ConsentRecord) {
    await this.sql.query(
      `insert into pgpc.consents (id, version, status, nhs_number, provider_ods, requested_at, record)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [r.id, r.version, r.status, r.patient.nhsNumber, r.provider.odsCode, r.requestedAt, JSON.stringify(r)],
    )
  }

  async update(r: ConsentRecord) {
    const rows = await this.sql.query(
      `update pgpc.consents
          set version = $2, status = $3, record = $4::jsonb, updated_at = now()
        where id = $1 and version = $5
      returning id`,
      [r.id, r.version, r.status, JSON.stringify(r), r.version - 1],
    )
    if (rows.length === 0) throw new ConcurrentModificationError(r.id)
  }

  async listByPatient(nhsNumber: string) {
    const rows = await this.sql.query<Row>(
      'select record from pgpc.consents where nhs_number = $1 order by requested_at desc',
      [nhsNumber],
    )
    return rows.map(r => r.record)
  }

  async listByProvider(odsCode: string) {
    const rows = await this.sql.query<Row>(
      'select record from pgpc.consents where provider_ods = $1 order by requested_at desc',
      [odsCode],
    )
    return rows.map(r => r.record)
  }

  async list(query: { status?: ConsentStatus; limit: number }) {
    const rows = query.status
      ? await this.sql.query<Row>('select record from pgpc.consents where status = $1 order by requested_at desc limit $2', [query.status, query.limit])
      : await this.sql.query<Row>('select record from pgpc.consents order by requested_at desc limit $1', [query.limit])
    return rows.map(r => r.record)
  }
}
