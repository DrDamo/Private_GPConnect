import { createHash, createHmac } from 'node:crypto'
import type { JsonValue } from './types'

// Append-only, hash-chained audit trail (PLAN.md §4.1 principle 4). Each event
// commits to the hash of the one before it, so any edit, deletion or
// re-ordering of stored events is detectable by verifyChain().
//
// NHS numbers never enter the audit log in clear: events carry a keyed
// pseudonym (HMAC-SHA256) so a patient's own access log can still be queried.

export const GENESIS_HASH = '0'.repeat(64)

export type AuditOutcome = 'success' | 'denied' | 'failure'

export interface AuditActor {
  type: 'user' | 'patient' | 'system'
  id: string
  organisationOdsCode?: string
  role?: string
}

export interface AuditEventInput {
  /** Dotted event name, e.g. `consent.granted`, `access.denied`, `pds.search`. */
  type: string
  outcome: AuditOutcome
  actor: AuditActor
  /** Pseudonymised patient reference (see pseudonymiseNhsNumber). */
  patientRef?: string
  consentId?: string
  correlationId: string
  details?: { [key: string]: JsonValue }
}

export interface AuditEvent extends AuditEventInput {
  seq: number
  id: string
  recordedAt: string
  prevHash: string
  hash: string
}

export interface ChainTail {
  seq: number
  hash: string
}

/**
 * Storage for audit events. `append` must be atomic with respect to other
 * appends: read the current tail, call `build` with it, and persist the result
 * before anyone else can append.
 */
export interface AuditStore {
  append(build: (tail: ChainTail | null) => AuditEvent): Promise<AuditEvent>
  /**
   * Events matching the filters. Ascending from `afterSeq` by default; with
   * order 'desc', newest first from before `beforeSeq`.
   */
  list(query: AuditQuery): Promise<AuditEvent[]>
}

export interface AuditQuery {
  limit: number
  afterSeq?: number
  beforeSeq?: number
  order?: 'asc' | 'desc'
  patientRef?: string
  consentId?: string
  /** Exact type, or a prefix ending in '.', e.g. 'access.' */
  type?: string
  outcome?: AuditOutcome
}

/** Shared filter semantics for store implementations. */
export function matchesAuditQuery(e: AuditEvent, q: AuditQuery): boolean {
  return (
    (q.afterSeq === undefined || e.seq > q.afterSeq) &&
    (q.beforeSeq === undefined || e.seq < q.beforeSeq) &&
    (q.patientRef === undefined || e.patientRef === q.patientRef) &&
    (q.consentId === undefined || e.consentId === q.consentId) &&
    (q.outcome === undefined || e.outcome === q.outcome) &&
    (q.type === undefined || (q.type.endsWith('.') ? e.type.startsWith(q.type) : e.type === q.type))
  )
}

/** JSON with object keys sorted recursively, so hashing is independent of key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    }
    return v
  })
}

export function hashEvent(event: Omit<AuditEvent, 'hash'>): string {
  const { seq, id, recordedAt, type, outcome, actor, patientRef, consentId, correlationId, details, prevHash } = event
  const body = { seq, id, recordedAt, type, outcome, actor, patientRef, consentId, correlationId, details, prevHash }
  return createHash('sha256').update(canonicalJson(body)).digest('hex')
}

export function buildEvent(
  input: AuditEventInput,
  tail: ChainTail | null,
  meta: { id: string; recordedAt: string },
): AuditEvent {
  const unhashed: Omit<AuditEvent, 'hash'> = {
    ...input,
    seq: tail ? tail.seq + 1 : 1,
    id: meta.id,
    recordedAt: meta.recordedAt,
    prevHash: tail ? tail.hash : GENESIS_HASH,
  }
  return { ...unhashed, hash: hashEvent(unhashed) }
}

export function pseudonymiseNhsNumber(nhsNumber: string, key: string): string {
  return createHmac('sha256', key).update(nhsNumber.replace(/\s/g, '')).digest('hex')
}

export type ChainVerification =
  | { valid: true; checked: number; tail: ChainTail | null }
  | { valid: false; checked: number; seq: number; problem: 'sequence-gap' | 'broken-link' | 'hash-mismatch' }

/**
 * Walks the whole chain in pages and checks every link. `checked` counts
 * events verified before the first problem.
 */
export async function verifyChain(store: AuditStore, pageSize = 500): Promise<ChainVerification> {
  let tail: ChainTail | null = null
  let checked = 0
  for (;;) {
    const page = await store.list({ afterSeq: tail?.seq ?? 0, limit: pageSize })
    for (const event of page) {
      const expectedSeq: number = (tail?.seq ?? 0) + 1
      if (event.seq !== expectedSeq) return { valid: false, checked, seq: expectedSeq, problem: 'sequence-gap' }
      if (event.prevHash !== (tail?.hash ?? GENESIS_HASH)) {
        return { valid: false, checked, seq: event.seq, problem: 'broken-link' }
      }
      const { hash, ...unhashed } = event
      if (hashEvent(unhashed) !== hash) return { valid: false, checked, seq: event.seq, problem: 'hash-mismatch' }
      tail = { seq: event.seq, hash }
      checked++
    }
    if (page.length < pageSize) return { valid: true, checked, tail }
  }
}

export interface AuditLogOptions {
  pseudonymKey: string
  clock?: () => Date
  newId?: () => string
}

/** Convenience wrapper: stamps, chains and pseudonymises events. */
export class AuditLog {
  private readonly clock: () => Date
  private readonly newId: () => string
  private readonly store: AuditStore
  private readonly pseudonymKey: string
  private readonly options: AuditLogOptions

  constructor(store: AuditStore, options: AuditLogOptions) {
    if (!options.pseudonymKey) throw new Error('AuditLog requires a pseudonymKey')
    this.store = store
    this.options = options
    this.pseudonymKey = options.pseudonymKey
    this.clock = options.clock ?? (() => new Date())
    this.newId = options.newId ?? (() => crypto.randomUUID())
  }

  /** The same log (key, clock, ids) writing through another store, e.g. one bound to a transaction. */
  using(store: AuditStore): AuditLog {
    return new AuditLog(store, this.options)
  }

  patientRef(nhsNumber: string): string {
    return pseudonymiseNhsNumber(nhsNumber, this.pseudonymKey)
  }

  record(input: Omit<AuditEventInput, 'patientRef'> & { nhsNumber?: string }): Promise<AuditEvent> {
    const { nhsNumber, ...rest } = input
    const event: AuditEventInput = nhsNumber ? { ...rest, patientRef: this.patientRef(nhsNumber) } : rest
    return this.store.append(tail =>
      buildEvent(event, tail, { id: this.newId(), recordedAt: this.clock().toISOString() }),
    )
  }

  forPatient(nhsNumber: string, options: { afterSeq?: number; limit?: number } = {}): Promise<AuditEvent[]> {
    return this.store.list({ patientRef: this.patientRef(nhsNumber), limit: options.limit ?? 100, afterSeq: options.afterSeq })
  }

  /** Newest first, for consoles. */
  latest(query: Omit<AuditQuery, 'order' | 'afterSeq'>): Promise<AuditEvent[]> {
    return this.store.list({ ...query, order: 'desc' })
  }

  forConsent(consentId: string, options: { afterSeq?: number; limit?: number } = {}): Promise<AuditEvent[]> {
    return this.store.list({ consentId, limit: options.limit ?? 200, afterSeq: options.afterSeq })
  }

  verify(pageSize?: number): Promise<ChainVerification> {
    return verifyChain(this.store, pageSize)
  }
}
