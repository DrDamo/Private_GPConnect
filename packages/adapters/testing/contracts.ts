import { describe, expect, it } from 'vitest'
import type { SimOutbox } from '../src'

export function simOutboxContract(name: string, make: () => Promise<SimOutbox>) {
  describe(`SimOutbox contract: ${name}`, () => {
    const msg = (n: number, to = '07700900001') => ({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      sentAt: new Date(Date.UTC(2026, 9, 1, 9, 0, n)).toISOString(),
      to,
      body: `message ${n}`,
      ...(n === 1 ? { reference: 'ref-1' } : {}),
    })

    it('lists newest first, filtered by recipient, limited', async () => {
      const outbox = await make()
      await outbox.add(msg(1))
      await outbox.add(msg(2, '07700900002'))
      await outbox.add(msg(3))
      expect((await outbox.list({ to: '07700900001', limit: 10 })).map(m => m.body)).toEqual(['message 3', 'message 1'])
      expect((await outbox.list({ limit: 2 })).map(m => m.body)).toEqual(['message 3', 'message 2'])
    })

    it('round-trips a message exactly', async () => {
      const outbox = await make()
      await outbox.add(msg(1))
      expect(await outbox.list({ limit: 1 })).toEqual([msg(1)])
    })
  })
}

export function simMeshStoreContract(name: string, make: () => Promise<import('../src').SimMeshStore>) {
  describe(`SimMeshStore contract: ${name}`, () => {
    const msg = (n: number, to = 'SIMGP1OT001') => ({
      id: `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      sentAt: new Date(Date.UTC(2026, 9, 1, 9, 0, n)).toISOString(),
      from: 'SIMMW1OT001',
      to,
      workflowId: 'GPFED_CONSULT_REPORT',
      localId: `consent-${n}`,
      subject: `Doc ${n}`,
      contentType: 'application/fhir+json',
      content: { resourceType: 'Bundle', type: 'message', n },
      status: 'accepted' as const,
      statusAt: new Date(Date.UTC(2026, 9, 1, 9, 0, n)).toISOString(),
    })

    it('round-trips, lists per mailbox newest first, and updates status', async () => {
      const store = await make()
      await store.add(msg(1))
      await store.add(msg(2, 'SIMGP2OT001'))
      await store.add(msg(3))
      expect(await store.get(msg(1).id)).toEqual(msg(1))
      expect((await store.listForMailbox('SIMGP1OT001', 10)).map(m => m.subject)).toEqual(['Doc 3', 'Doc 1'])
      expect(await store.setStatus(msg(1).id, 'acknowledged', '2026-10-01T10:00:00.000Z', 'Filed in patient record')).toBe(true)
      expect(await store.get(msg(1).id)).toMatchObject({ status: 'acknowledged', statusAt: '2026-10-01T10:00:00.000Z', statusNote: 'Filed in patient record' })
      expect(await store.setStatus('30000000-0000-4000-8000-00000000ffff', 'acknowledged', '2026-10-01T10:00:00.000Z')).toBe(false)
    })
  })
}
