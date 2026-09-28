import { describe, expect, it } from 'vitest'
import { AdapterError, InMemoryOutbox, MockSms } from '../src'
import { simOutboxContract } from '../testing/contracts'

simOutboxContract('in-memory', async () => new InMemoryOutbox())

const NOW = new Date('2026-10-01T09:00:00Z')

describe('MockSms', () => {
  it('delivers to the simulated outbox, newest first', async () => {
    const outbox = new InMemoryOutbox()
    const sms = new MockSms(outbox, () => NOW)
    await sms.send({ to: '07700 900001', body: 'first', reference: 'consent-1' })
    const { messageId } = await sms.send({ to: '07700900001', body: 'second' })
    await sms.send({ to: '07700900002', body: 'someone else' })
    const inbox = await outbox.list({ to: '07700900001', limit: 10 })
    expect(inbox.map(m => m.body)).toEqual(['second', 'first'])
    expect(inbox[0]).toMatchObject({ id: messageId, sentAt: NOW.toISOString(), to: '07700900001' })
    expect(inbox[1].reference).toBe('consent-1')
  })

  it.each(['07700900', '07700901000', '07911123456', '+447700900001'])('refuses real-looking number %s', async to => {
    const sms = new MockSms(new InMemoryOutbox())
    await expect(sms.send({ to, body: 'x' })).rejects.toBeInstanceOf(AdapterError)
  })

  it('rejects empty and over-long messages', async () => {
    const sms = new MockSms(new InMemoryOutbox())
    await expect(sms.send({ to: '07700900001', body: '' })).rejects.toBeInstanceOf(AdapterError)
    await expect(sms.send({ to: '07700900001', body: 'x'.repeat(919) })).rejects.toBeInstanceOf(AdapterError)
  })
})
