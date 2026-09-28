import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

// One-time passcodes for the SMS consent route (PLAN.md §2.4). Codes are
// hashed at rest, expire after 10 minutes, allow 5 attempts, and a subject
// (a consent) can only have a few codes sent per window to stop SMS bombing.

export interface OtpChallenge {
  id: string
  /** What the code unlocks, e.g. a consent id. */
  subjectRef: string
  destination: string
  codeHash: string
  createdAt: string
  expiresAt: string
  attempts: number
  consumedAt?: string
}

export interface OtpStore {
  insert(challenge: OtpChallenge): Promise<void>
  get(id: string): Promise<OtpChallenge | null>
  /** Atomically increments attempts and returns the updated challenge (null if missing). */
  incrementAttempts(id: string): Promise<OtpChallenge | null>
  /** Marks consumed; false if it was already consumed (single use, race-safe). */
  consume(id: string, at: string): Promise<boolean>
  countSince(subjectRef: string, since: string): Promise<number>
}

export const OTP_TTL_MS = 10 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_SENDS = 3
export const OTP_SEND_WINDOW_MS = 15 * 60 * 1000

export type OtpIssueResult = { ok: true; challenge: OtpChallenge; code: string } | { ok: false; reason: 'rate-limited' }

export type OtpVerifyResult =
  | { ok: true; challenge: OtpChallenge }
  | { ok: false; reason: 'not-found' | 'expired' | 'consumed' | 'too-many-attempts' | 'wrong-code'; attemptsLeft?: number }

export class OtpService {
  private readonly store: OtpStore
  private readonly key: string
  private readonly clock: () => Date
  private readonly newId: () => string
  private readonly generate: () => string

  constructor(options: {
    store: OtpStore
    key: string
    clock?: () => Date
    newId?: () => string
    /** Injectable for tests only. */
    generateCode?: () => string
  }) {
    if (!options.key) throw new Error('OtpService requires a key')
    this.store = options.store
    this.key = options.key
    this.clock = options.clock ?? (() => new Date())
    this.newId = options.newId ?? (() => crypto.randomUUID())
    this.generate = options.generateCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, '0'))
  }

  private hash(challengeId: string, code: string) {
    return createHmac('sha256', this.key).update(`${challengeId}:${code}`).digest('hex')
  }

  /** The challenge's non-secret details (subject and destination), e.g. to route verification. */
  getChallenge(id: string): Promise<OtpChallenge | null> {
    return this.store.get(id)
  }

  async issue(subjectRef: string, destination: string): Promise<OtpIssueResult> {
    const now = this.clock()
    const recent = await this.store.countSince(subjectRef, new Date(now.getTime() - OTP_SEND_WINDOW_MS).toISOString())
    if (recent >= OTP_MAX_SENDS) return { ok: false, reason: 'rate-limited' }
    const id = this.newId()
    const code = this.generate()
    const challenge: OtpChallenge = {
      id,
      subjectRef,
      destination,
      codeHash: this.hash(id, code),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + OTP_TTL_MS).toISOString(),
      attempts: 0,
    }
    await this.store.insert(challenge)
    return { ok: true, challenge, code }
  }

  /**
   * Checks a code. `extraCheck` lets the caller add a knowledge check (e.g.
   * date of birth) that consumes an attempt on failure just like a wrong code.
   */
  async verify(challengeId: string, code: string, extraCheck: () => boolean = () => true): Promise<OtpVerifyResult> {
    const now = this.clock()
    const existing = await this.store.get(challengeId)
    if (!existing) return { ok: false, reason: 'not-found' }
    if (existing.consumedAt) return { ok: false, reason: 'consumed' }
    if (now >= new Date(existing.expiresAt)) return { ok: false, reason: 'expired' }
    if (existing.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too-many-attempts' }

    const challenge = await this.store.incrementAttempts(challengeId)
    if (!challenge) return { ok: false, reason: 'not-found' }
    if (challenge.attempts > OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too-many-attempts' }

    const expected = Buffer.from(challenge.codeHash, 'hex')
    const given = Buffer.from(this.hash(challengeId, code.trim()), 'hex')
    const codeOk = /^\d{6}$/.test(code.trim()) && timingSafeEqual(expected, given)
    if (!codeOk || !extraCheck()) {
      const attemptsLeft = OTP_MAX_ATTEMPTS - challenge.attempts
      return attemptsLeft > 0
        ? { ok: false, reason: 'wrong-code', attemptsLeft }
        : { ok: false, reason: 'too-many-attempts' }
    }
    if (!(await this.store.consume(challengeId, now.toISOString()))) return { ok: false, reason: 'consumed' }
    return { ok: true, challenge: { ...challenge, consumedAt: now.toISOString() } }
  }
}

export class InMemoryOtpStore implements OtpStore {
  private readonly items = new Map<string, OtpChallenge>()
  async insert(c: OtpChallenge) {
    this.items.set(c.id, structuredClone(c))
  }
  async get(id: string) {
    const c = this.items.get(id)
    return c ? structuredClone(c) : null
  }
  async incrementAttempts(id: string) {
    const c = this.items.get(id)
    if (!c) return null
    c.attempts++
    return structuredClone(c)
  }
  async consume(id: string, at: string) {
    const c = this.items.get(id)
    if (!c || c.consumedAt) return false
    c.consumedAt = at
    return true
  }
  async countSince(subjectRef: string, since: string) {
    return [...this.items.values()].filter(c => c.subjectRef === subjectRef && c.createdAt >= since).length
  }
}
