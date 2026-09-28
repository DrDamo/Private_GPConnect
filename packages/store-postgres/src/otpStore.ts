import type { OtpChallenge, OtpStore } from '@pgpc/core'
import type { SqlClient } from './sql'

type Row = {
  id: string
  subject_ref: string
  destination: string
  code_hash: string
  created_at: Date | string
  expires_at: Date | string
  attempts: number
  consumed_at: Date | string | null
}

const iso = (v: Date | string) => new Date(v).toISOString()

function toChallenge(r: Row): OtpChallenge {
  return {
    id: r.id,
    subjectRef: r.subject_ref,
    destination: r.destination,
    codeHash: r.code_hash,
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
    attempts: Number(r.attempts),
    ...(r.consumed_at ? { consumedAt: iso(r.consumed_at) } : {}),
  }
}

export class PostgresOtpStore implements OtpStore {
  private readonly sql: SqlClient
  constructor(sql: SqlClient) {
    this.sql = sql
  }

  async insert(c: OtpChallenge) {
    await this.sql.query(
      `insert into pgpc.otp_challenges (id, subject_ref, destination, code_hash, created_at, expires_at, attempts)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [c.id, c.subjectRef, c.destination, c.codeHash, c.createdAt, c.expiresAt, c.attempts],
    )
  }

  async get(id: string) {
    const [row] = await this.sql.query<Row>('select * from pgpc.otp_challenges where id = $1', [id])
    return row ? toChallenge(row) : null
  }

  async incrementAttempts(id: string) {
    const [row] = await this.sql.query<Row>(
      'update pgpc.otp_challenges set attempts = attempts + 1 where id = $1 returning *',
      [id],
    )
    return row ? toChallenge(row) : null
  }

  async consume(id: string, at: string) {
    const rows = await this.sql.query(
      'update pgpc.otp_challenges set consumed_at = $2 where id = $1 and consumed_at is null returning id',
      [id, at],
    )
    return rows.length === 1
  }

  async countSince(subjectRef: string, since: string) {
    const [row] = await this.sql.query<{ n: number | string }>(
      'select count(*)::int as n from pgpc.otp_challenges where subject_ref = $1 and created_at >= $2',
      [subjectRef, since],
    )
    return Number(row?.n ?? 0)
  }
}
