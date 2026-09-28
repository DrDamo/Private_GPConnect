import type { AuditEvent, AuditStore, ChainTail } from './audit'
import type { ConsentRecord } from './consent'

export interface ConsentRepository {
  get(id: string): Promise<ConsentRecord | null>
  insert(record: ConsentRecord): Promise<void>
  /**
   * Optimistic concurrency: succeeds only if the stored version is
   * `record.version - 1`; otherwise throws ConcurrentModificationError.
   */
  update(record: ConsentRecord): Promise<void>
  listByPatient(nhsNumber: string): Promise<ConsentRecord[]>
  listByProvider(odsCode: string): Promise<ConsentRecord[]>
}

export class ConcurrentModificationError extends Error {
  constructor(id: string) {
    super(`Consent ${id} was modified by someone else`)
    this.name = 'ConcurrentModificationError'
  }
}

const clone = <T>(value: T): T => structuredClone(value)
const newestFirst = (a: ConsentRecord, b: ConsentRecord) => b.requestedAt.localeCompare(a.requestedAt)

/** In-memory stores for tests and local development. */
export class InMemoryConsentRepository implements ConsentRepository {
  private readonly records = new Map<string, ConsentRecord>()

  async get(id: string) {
    const r = this.records.get(id)
    return r ? clone(r) : null
  }

  async insert(record: ConsentRecord) {
    if (this.records.has(record.id)) throw new Error(`Consent ${record.id} already exists`)
    this.records.set(record.id, clone(record))
  }

  async update(record: ConsentRecord) {
    const current = this.records.get(record.id)
    if (!current || current.version !== record.version - 1) throw new ConcurrentModificationError(record.id)
    this.records.set(record.id, clone(record))
  }

  async listByPatient(nhsNumber: string) {
    return [...this.records.values()].filter(r => r.patient.nhsNumber === nhsNumber).sort(newestFirst).map(clone)
  }

  async listByProvider(odsCode: string) {
    return [...this.records.values()].filter(r => r.provider.odsCode === odsCode).sort(newestFirst).map(clone)
  }
}

export class InMemoryAuditStore implements AuditStore {
  private readonly events: AuditEvent[] = []
  // Serialise appends so concurrent callers can't fork the chain.
  private queue: Promise<unknown> = Promise.resolve()

  append(build: (tail: ChainTail | null) => AuditEvent): Promise<AuditEvent> {
    const run = this.queue.then(() => {
      const last = this.events.at(-1)
      const event = build(last ? { seq: last.seq, hash: last.hash } : null)
      this.events.push(clone(event))
      return clone(event)
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  async list(query: { afterSeq?: number; limit: number; patientRef?: string; consentId?: string }) {
    return this.events
      .filter(
        e =>
          e.seq > (query.afterSeq ?? 0) &&
          (query.patientRef === undefined || e.patientRef === query.patientRef) &&
          (query.consentId === undefined || e.consentId === query.consentId),
      )
      .slice(0, query.limit)
      .map(clone)
  }

  /** Test helper: direct access to stored events, e.g. to simulate tampering. */
  unsafeEvents(): AuditEvent[] {
    return this.events
  }
}
