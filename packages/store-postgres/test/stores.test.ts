import { describe, expect, it } from 'vitest'
import { AuditLog, buildEvent, verifyChain, type ConsentRecord } from '@pgpc/core'
import { auditStoreContract, consentRepositoryContract, otpStoreContract } from '@pgpc/core/testing'
import { simMeshStoreContract, simOutboxContract } from '@pgpc/adapters/testing'
import { PostgresAuditStore, PostgresConsentRepository, PostgresFaultSource, PostgresMeshStore, PostgresOtpStore, PostgresOutbox } from '../src'
import { freshDatabase, withPostgresJsBinding } from './pglite'

auditStoreContract('postgres', async () => new PostgresAuditStore((await freshDatabase()).sql))
consentRepositoryContract('postgres', async () => new PostgresConsentRepository((await freshDatabase()).sql))
otpStoreContract('postgres', async () => new PostgresOtpStore((await freshDatabase()).sql))
simMeshStoreContract('postgres', async () => new PostgresMeshStore((await freshDatabase()).sql))
simOutboxContract('postgres', async () => new PostgresOutbox((await freshDatabase()).sql))

// Again with the production driver's parameter binding (see withPostgresJsBinding).
const pgjs = async () => withPostgresJsBinding((await freshDatabase()).sql)
auditStoreContract('postgres, postgres.js binding', async () => new PostgresAuditStore(await pgjs()))
consentRepositoryContract('postgres, postgres.js binding', async () => new PostgresConsentRepository(await pgjs()))
simMeshStoreContract('postgres, postgres.js binding', async () => new PostgresMeshStore(await pgjs()))

describe('rows written double-encoded before 30 Sep 2026', () => {
  it('stores JSON objects, not JSON strings', async () => {
    const { db, sql } = await freshDatabase()
    const log = new AuditLog(new PostgresAuditStore(withPostgresJsBinding(sql)), { pseudonymKey: 'k' })
    await log.record({ type: 't', outcome: 'success', actor: { type: 'system', id: 's' }, correlationId: 'c' })
    const repo = new PostgresConsentRepository(withPostgresJsBinding(sql))
    const consent = {
      id: '10000000-0000-4000-8000-000000000002',
      version: 1,
      status: 'pending',
      patient: { nhsNumber: '9990000018' },
      provider: { odsCode: 'SIMPH1' },
      requestedAt: '2026-09-30T09:00:00.000Z',
    } as unknown as ConsentRecord
    await repo.insert(consent)
    await repo.update({ ...consent, version: 2 })
    await new PostgresMeshStore(withPostgresJsBinding(sql)).add({
      id: '20000000-0000-4000-8000-000000000001',
      sentAt: '2026-09-30T09:00:00.000Z',
      from: 'A',
      to: 'B',
      workflowId: 'W',
      localId: 'L',
      subject: 'S',
      contentType: 'application/fhir+json',
      content: { resourceType: 'Bundle' },
      status: 'accepted',
      statusAt: '2026-09-30T09:00:00.000Z',
    })
    const { rows } = await db.query<{ t: string }>(
      `select jsonb_typeof(event) as t from pgpc.audit_events
       union all select jsonb_typeof(record) from pgpc.consents
       union all select jsonb_typeof(content) from pgpc.sim_mesh_messages`,
    )
    expect(rows).toEqual([{ t: 'object' }, { t: 'object' }, { t: 'object' }])
  })

  it('still reads a legacy string-encoded consent and audit event, and extends the chain after it', async () => {
    const { db, sql } = await freshDatabase()
    const legacy = buildEvent({ type: 't', outcome: 'success', actor: { type: 'system', id: 's' }, correlationId: 'c0' }, null, {
      id: '00000000-0000-4000-8000-000000000001',
      recordedAt: '2026-09-29T10:00:00.000Z',
    })
    await db.query(
      `insert into pgpc.audit_events (seq, id, recorded_at, type, outcome, correlation_id, prev_hash, hash, event)
       values (1, $1, $2, 't', 'success', 'c0', $3, $4, to_jsonb($5::text))`,
      [legacy.id, legacy.recordedAt, legacy.prevHash, legacy.hash, JSON.stringify(legacy)],
    )
    const store = new PostgresAuditStore(sql)
    await new AuditLog(store, { pseudonymKey: 'k' }).record({ type: 't', outcome: 'success', actor: { type: 'system', id: 's' }, correlationId: 'c1' })
    expect((await store.list({ limit: 10 })).map(e => e.seq)).toEqual([1, 2])
    expect(await verifyChain(store)).toMatchObject({ valid: true, checked: 2 })

    const record = { id: '10000000-0000-4000-8000-000000000001', patient: { nhsNumber: '9990000018' } }
    await db.query(
      `insert into pgpc.consents (id, version, status, nhs_number, provider_ods, requested_at, record)
       values ($1, 1, 'pending', '9990000018', 'SIMPH1', now(), to_jsonb($2::text))`,
      [record.id, JSON.stringify(record)],
    )
    expect(await new PostgresConsentRepository(sql).get(record.id)).toEqual(record)
  })
})

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
