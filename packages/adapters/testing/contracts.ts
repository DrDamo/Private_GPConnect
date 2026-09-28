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
