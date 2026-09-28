import { AdapterError } from '../errors'
import type { SmsAdapter } from '../sms'

// Simulated SMS: messages land in an outbox shown on the simulator's on-screen
// "phone". As a hard safety guard it refuses any number outside Ofcom's
// reserved drama range, so a fixture mistake can never text a real person.

export interface OutboxMessage {
  id: string
  sentAt: string
  to: string
  body: string
  reference?: string
}

export interface SimOutbox {
  add(message: OutboxMessage): Promise<void>
  /** Newest first. */
  list(query: { to?: string; limit: number }): Promise<OutboxMessage[]>
}

export class InMemoryOutbox implements SimOutbox {
  private readonly messages: OutboxMessage[] = []
  async add(message: OutboxMessage) {
    this.messages.push(structuredClone(message))
  }
  async list(query: { to?: string; limit: number }) {
    return this.messages
      .filter(m => !query.to || m.to === query.to)
      .slice()
      .reverse()
      .slice(0, query.limit)
      .map(m => structuredClone(m))
  }
}

export const DRAMA_MOBILE_RANGE = /^07700900\d{3}$/

export class MockSms implements SmsAdapter {
  private readonly outbox: SimOutbox
  private readonly clock: () => Date
  constructor(outbox: SimOutbox, clock: () => Date = () => new Date()) {
    this.outbox = outbox
    this.clock = clock
  }

  async send(message: { to: string; body: string; reference?: string }) {
    const to = message.to.replace(/\s/g, '')
    if (!DRAMA_MOBILE_RANGE.test(to)) {
      throw new AdapterError('sms', 'invalid-request', 'Simulator only sends to 07700 900xxx numbers')
    }
    if (!message.body || message.body.length > 918) {
      throw new AdapterError('sms', 'invalid-request', 'Message must be 1–918 characters')
    }
    const id = crypto.randomUUID()
    await this.outbox.add({
      id,
      sentAt: this.clock().toISOString(),
      to,
      body: message.body,
      ...(message.reference ? { reference: message.reference } : {}),
    })
    return { messageId: id }
  }
}
