import { describe, expect, it } from 'vitest'
import { AuditLog, verifyChain } from '@pgpc/core'
import { auditStoreContract, consentRepositoryContract } from '@pgpc/core/testing'
import { PostgresAuditStore, PostgresConsentRepository } from '../src'
import { freshDatabase } from './pglite'

auditStoreContract('postgres', async () => new PostgresAuditStore((await freshDatabase()).sql))
consentRepositoryContract('postgres', async () => new PostgresConsentRepository((await freshDatabase()).sql))

describe('audit_events table is append-only', () => {
  const seeded = async () => {
    const { db, sql } = await freshDatabase()
    const log = new AuditLog(new PostgresAuditStore(sql), { pseudonymKey: 'k' })
    await log.record({ type: 't', outcome: 'success', actor: { type: 'system', id: 's' }, correlationId: 'c' })
    return db
  }

  it.each([
    ['UPDATE', "update pgpc.audit_events set outcome = 'denied'"],
    ['DELETE', 'delete from pgpc.audit_events'],
    ['TRUNCATE', 'truncate pgpc.audit_events'],
  ])('rejects %s', async (op, statement) => {
    const db = await seeded()
    await expect(db.exec(statement)).rejects.toThrow(`append-only (${op} rejected)`)
  })
})

describe('tampering below the application is detected', () => {
  it('an event edited directly in the database fails verification', async () => {
    const { db, sql } = await freshDatabase()
    const store = new PostgresAuditStore(sql)
    const log = new AuditLog(store, { pseudonymKey: 'k' })
    for (let i = 0; i < 3; i++) {
      await log.record({ type: 't', outcome: 'success', actor: { type: 'system', id: 's' }, correlationId: `c${i}` })
    }
    // An attacker with superuser access disables the guard and edits history.
    await db.exec(`
      alter table pgpc.audit_events disable trigger audit_events_no_update_delete;
      update pgpc.audit_events set event = jsonb_set(event, '{outcome}', '"denied"') where seq = 2;
    `)
    expect(await verifyChain(store)).toMatchObject({ valid: false, seq: 2, problem: 'hash-mismatch' })
  })
})

describe('consents table constraints', () => {
  it('rejects a malformed NHS number even if the application let one through', async () => {
    const { db } = await freshDatabase()
    await expect(
      db.query(
        `insert into pgpc.consents (id, version, status, nhs_number, provider_ods, requested_at, record)
         values (gen_random_uuid(), 1, 'pending', '123', 'X', now(), '{}')`,
      ),
    ).rejects.toThrow(/consents_nhs_number_check/)
  })
})
