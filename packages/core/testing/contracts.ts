// Contract tests every store implementation must pass (in-memory now, Postgres
// and anything else later). Import from '@pgpc/core/testing' in a test file and
// call with a factory that returns a fresh, empty store.
import { describe, expect, it } from 'vitest'
import {
  buildEvent,
  ConcurrentModificationError,
  createConsentRequest,
  grantConsent,
  verifyChain,
  type AuditEventInput,
  type AuditStore,
  type ConsentRepository,
} from '../src'

const NOW = new Date('2026-10-01T09:00:00Z')

const input = (n: number, patientRef = 'p-ref-1', consentId?: string): AuditEventInput => ({
  type: 'test.event',
  outcome: 'success',
  actor: { type: 'system', id: 'contract-test' },
  patientRef,
  ...(consentId ? { consentId } : {}),
  correlationId: `corr-${n}`,
  details: { n, nested: { b: 2, a: [1, 'x', null, true] } },
})

export function auditStoreContract(name: string, makeStore: () => Promise<AuditStore>) {
  describe(`AuditStore contract: ${name}`, () => {
    const appendN = async (store: AuditStore, n: number) => {
      for (let i = 1; i <= n; i++) {
        await store.append(tail =>
          buildEvent(input(i, i % 2 ? 'p-odd' : 'p-even', i === 2 ? '00000000-0000-4000-8000-000000000002' : undefined), tail, {
            id: crypto.randomUUID(),
            recordedAt: new Date(NOW.getTime() + i * 1000).toISOString(),
          }),
        )
      }
    }

    it('starts empty and verifies as a valid empty chain', async () => {
      const store = await makeStore()
      expect(await store.list({ limit: 10 })).toEqual([])
      expect(await verifyChain(store)).toEqual({ valid: true, checked: 0, tail: null })
    })

    it('chains sequential appends and round-trips events exactly', async () => {
      const store = await makeStore()
      await appendN(store, 5)
      const events = await store.list({ limit: 10 })
      expect(events.map(e => e.seq)).toEqual([1, 2, 3, 4, 5])
      expect(events[1].prevHash).toBe(events[0].hash)
      expect(events[0].details).toEqual({ n: 1, nested: { b: 2, a: [1, 'x', null, true] } })
      const result = await verifyChain(store, 2)
      expect(result).toMatchObject({ valid: true, checked: 5 })
    })

    it('does not fork the chain under concurrent appends', async () => {
      const store = await makeStore()
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          store.append(tail => buildEvent(input(i), tail, { id: crypto.randomUUID(), recordedAt: NOW.toISOString() })),
        ),
      )
      const result = await verifyChain(store)
      expect(result).toMatchObject({ valid: true, checked: 20 })
    })

    it('pages with afterSeq and limit, and filters by patientRef and consentId', async () => {
      const store = await makeStore()
      await appendN(store, 6)
      expect((await store.list({ afterSeq: 2, limit: 3 })).map(e => e.seq)).toEqual([3, 4, 5])
      expect((await store.list({ patientRef: 'p-even', limit: 10 })).map(e => e.seq)).toEqual([2, 4, 6])
      expect(
        (await store.list({ consentId: '00000000-0000-4000-8000-000000000002', limit: 10 })).map(e => e.seq),
      ).toEqual([2])
    })
  })
}

export function consentRepositoryContract(name: string, makeRepo: () => Promise<ConsentRepository>) {
  describe(`ConsentRepository contract: ${name}`, () => {
    const request = (id: string, nhsNumber = '9692136701', odsCode = 'PHX01', at = NOW) =>
      createConsentRequest(
        {
          id,
          nhsNumber,
          provider: { odsCode, name: 'Example Online Pharmacy', type: 'pharmacy' },
          episode: { id: 'ep-1', purpose: 'Assessment' },
          requestedBy: { userId: 'u1', name: 'Dr A', role: 'clinician' },
        },
        at,
      )
    const decision = {
      assurance: 'nhs-login-p9' as const,
      evidence: { channel: 'nhs-login' as const, subject: 's', consentTextVersion: 'v1', consentTextHash: 'h' },
      verifiedNhsNumber: '9692136701',
    }

    it('round-trips a record exactly', async () => {
      const repo = await makeRepo()
      const r = request('10000000-0000-4000-8000-000000000001')
      await repo.insert(r)
      expect(await repo.get(r.id)).toEqual(r)
      expect(await repo.get('10000000-0000-4000-8000-00000000ffff')).toBeNull()
    })

    it('updates with optimistic concurrency', async () => {
      const repo = await makeRepo()
      const r = request('10000000-0000-4000-8000-000000000002')
      await repo.insert(r)
      const granted = grantConsent(r, decision, NOW)
      await repo.update(granted)
      expect(await repo.get(r.id)).toEqual(granted)
      // A second writer still holding version 1 must lose.
      await expect(repo.update(grantConsent(r, decision, NOW))).rejects.toBeInstanceOf(ConcurrentModificationError)
    })

    it('lists by patient and by provider, newest first', async () => {
      const repo = await makeRepo()
      await repo.insert(request('10000000-0000-4000-8000-000000000003', '9692136701', 'PHX01', new Date('2026-10-01T00:00:00Z')))
      await repo.insert(request('10000000-0000-4000-8000-000000000004', '9692136701', 'WMX02', new Date('2026-10-02T00:00:00Z')))
      await repo.insert(request('10000000-0000-4000-8000-000000000005', '9000000009', 'PHX01', new Date('2026-10-03T00:00:00Z')))
      expect((await repo.listByPatient('9692136701')).map(r => r.id)).toEqual([
        '10000000-0000-4000-8000-000000000004',
        '10000000-0000-4000-8000-000000000003',
      ])
      expect((await repo.listByProvider('PHX01')).map(r => r.id)).toEqual([
        '10000000-0000-4000-8000-000000000005',
        '10000000-0000-4000-8000-000000000003',
      ])
    })
  })
}
