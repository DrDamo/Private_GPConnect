import type { MeshMessage, MeshStatus, SimMeshStore } from '@pgpc/adapters'
import type { SqlClient } from './sql'

type Row = {
  id: string
  sent_at: Date | string
  from_mailbox: string
  to_mailbox: string
  workflow_id: string
  local_id: string
  subject: string
  content_type: string
  content: unknown
  status: MeshStatus
  status_at: Date | string
  status_note: string | null
}

const iso = (v: Date | string) => new Date(v).toISOString()
const toMessage = (r: Row): MeshMessage => ({
  id: r.id,
  sentAt: iso(r.sent_at),
  from: r.from_mailbox,
  to: r.to_mailbox,
  workflowId: r.workflow_id,
  localId: r.local_id,
  subject: r.subject,
  contentType: r.content_type,
  content: r.content,
  status: r.status,
  statusAt: iso(r.status_at),
  ...(r.status_note ? { statusNote: r.status_note } : {}),
})

export class PostgresMeshStore implements SimMeshStore {
  private readonly sql: SqlClient
  constructor(sql: SqlClient) {
    this.sql = sql
  }

  async add(m: MeshMessage) {
    await this.sql.query(
      `insert into pgpc.sim_mesh_messages
         (id, sent_at, from_mailbox, to_mailbox, workflow_id, local_id, subject, content_type, content, status, status_at, status_note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)`,
      [m.id, m.sentAt, m.from, m.to, m.workflowId, m.localId, m.subject, m.contentType, JSON.stringify(m.content), m.status, m.statusAt, m.statusNote ?? null],
    )
  }

  async get(id: string) {
    const [row] = await this.sql.query<Row>('select * from pgpc.sim_mesh_messages where id = $1', [id])
    return row ? toMessage(row) : null
  }

  async listForMailbox(mailbox: string, limit: number) {
    const rows = await this.sql.query<Row>(
      'select * from pgpc.sim_mesh_messages where to_mailbox = $1 order by sent_at desc limit $2',
      [mailbox, limit],
    )
    return rows.map(toMessage)
  }

  async setStatus(id: string, status: MeshStatus, at: string, note?: string) {
    const rows = await this.sql.query(
      'update pgpc.sim_mesh_messages set status = $2, status_at = $3, status_note = $4 where id = $1 returning id',
      [id, status, at, note ?? null],
    )
    return rows.length === 1
  }
}
