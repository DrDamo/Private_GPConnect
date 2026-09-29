import { describe, expect, it } from 'vitest'
import { AuditLog, verifyChain } from '@pgpc/core'
import { auditStoreContract, consentRepositoryContract, otpStoreContract } from '@pgpc/core/testing'
import { simMeshStoreContract, simOutboxContract } from '@pgpc/adapters/testing'
import { PostgresAuditStore, PostgresConsentRepository, PostgresFaultSource, PostgresMeshStore, PostgresOtpStore, PostgresOutbox } from '../src'
import { freshDatabase } from './pglite'

auditStoreContract('postgres', async () => new PostgresAuditStore((await freshDatabase()).sql))
consentRepositoryContract('postgres', async () => new PostgresConsentRepository((await freshDatabase()).sql))
otpStoreContract('postgres', async () => new PostgresOtpStore((await freshDatabase()).sql))
simMeshStoreContract('postgres', async () => new PostgresMeshStore((await freshDatabase()).sql))
simOutboxContract('postgres', async () => new PostgresOutbox((await freshDatabase()).sql))

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

describe('sim_sms_outbox', () => {
  it('refuses a number outside the drama range even if the application let one through', async () => {
    const { db } = await freshDatabase()
    await expect(
      db.query("insert into pgpc.sim_sms_outbox (id, sent_at, to_number, body) values (gen_random_uuid(), now(), '07911123456', 'x')"),
    ).rejects.toThrow(/sim_sms_outbox_to_number_check/)
  })
})

describe('PostgresFaultSource', () => {
  it('sets, reads, updates and clears faults (shared across instances)', async () => {
    const { sql } = await freshDatabase()
    const a = new PostgresFaultSource(sql, { ttlMs: 0 })
    const b = new PostgresFaultSource(sql, { ttlMs: 0 })
    await a.set('pds', { kind: 'timeout' })
    await a.set('gp-connect', { kind: 'latency', ms: 1500 })
    expect(await b.get('pds')).toEqual({ kind: 'timeout' })
    expect(await b.all()).toEqual({ pds: { kind: 'timeout' }, 'gp-connect': { kind: 'latency', ms: 1500 } })
    await a.set('pds', { kind: 'unavailable' })
    await a.set('gp-connect', null)
    expect(await b.all()).toEqual({ pds: { kind: 'unavailable' } })
  })

  it('caches reads for the configured time', async () => {
    const { sql } = await freshDatabase()
    const writer = new PostgresFaultSource(sql, { ttlMs: 0 })
    const reader = new PostgresFaultSource(sql, { ttlMs: 60_000 })
    expect(await reader.get('sms')).toBeNull()
    await writer.set('sms', { kind: 'timeout' })
    expect(await reader.get('sms')).toBeNull() // still cached
  })
})
