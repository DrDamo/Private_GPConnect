import { describe, expect, it } from 'vitest'
import { InMemoryOtpStore, OTP_MAX_ATTEMPTS, OtpService } from '../src'
import { otpStoreContract } from '../testing/contracts'

otpStoreContract('in-memory', async () => new InMemoryOtpStore())

const T0 = new Date('2026-10-01T09:00:00Z')

function setup() {
  let now = T0
  const store = new InMemoryOtpStore()
  const otp = new OtpService({ store, key: 'k', clock: () => now, generateCode: () => '123456' })
  return { otp, store, advance: (ms: number) => (now = new Date(now.getTime() + ms)) }
}

describe('OtpService', () => {
  it('issues a 6-digit code, stores only its hash, and verifies it once', async () => {
    const { otp, store } = setup()
    const issued = await otp.issue('consent-1', '07700900001')
    if (!issued.ok) throw new Error('not issued')
    expect(issued.code).toBe('123456')
    const stored = await store.get(issued.challenge.id)
    expect(JSON.stringify(stored)).not.toContain('123456')

    expect(await otp.verify(issued.challenge.id, ' 123456 ')).toMatchObject({ ok: true })
    expect(await otp.verify(issued.challenge.id, '123456')).toEqual({ ok: false, reason: 'consumed' })
  })

  it('generates random codes by default', async () => {
    const otp = new OtpService({ store: new InMemoryOtpStore(), key: 'k' })
    const codes = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const r = await otp.issue(`s${i}`, '07700900001')
      if (r.ok) codes.add(r.code)
    }
    for (const c of codes) expect(c).toMatch(/^\d{6}$/)
    expect(codes.size).toBeGreaterThan(1)
  })

  it('counts down attempts and locks after the maximum', async () => {
    const { otp } = setup()
    const issued = await otp.issue('consent-1', '07700900001')
    if (!issued.ok) throw new Error()
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      expect(await otp.verify(issued.challenge.id, '000000')).toEqual({ ok: false, reason: 'wrong-code', attemptsLeft: OTP_MAX_ATTEMPTS - i })
    }
    expect(await otp.verify(issued.challenge.id, '000000')).toEqual({ ok: false, reason: 'too-many-attempts' })
    expect(await otp.verify(issued.challenge.id, '123456')).toEqual({ ok: false, reason: 'too-many-attempts' })
  })

  it('treats a failed knowledge check like a wrong code', async () => {
    const { otp } = setup()
    const issued = await otp.issue('consent-1', '07700900001')
    if (!issued.ok) throw new Error()
    expect(await otp.verify(issued.challenge.id, '123456', () => false)).toMatchObject({ ok: false, reason: 'wrong-code' })
    expect(await otp.verify(issued.challenge.id, '123456', () => true)).toMatchObject({ ok: true })
  })

  it('expires codes after 10 minutes', async () => {
    const { otp, advance } = setup()
    const issued = await otp.issue('consent-1', '07700900001')
    if (!issued.ok) throw new Error()
    advance(10 * 60 * 1000)
    expect(await otp.verify(issued.challenge.id, '123456')).toEqual({ ok: false, reason: 'expired' })
  })

  it('rate-limits sends per subject within the window', async () => {
    const { otp, advance } = setup()
    for (let i = 0; i < 3; i++) expect((await otp.issue('consent-1', '07700900001')).ok).toBe(true)
    expect(await otp.issue('consent-1', '07700900001')).toEqual({ ok: false, reason: 'rate-limited' })
    expect((await otp.issue('consent-2', '07700900001')).ok).toBe(true)
    advance(15 * 60 * 1000 + 1)
    expect((await otp.issue('consent-1', '07700900001')).ok).toBe(true)
  })

  it('rejects malformed codes without throwing', async () => {
    const { otp } = setup()
    const issued = await otp.issue('consent-1', '07700900001')
    if (!issued.ok) throw new Error()
    expect(await otp.verify(issued.challenge.id, 'abc')).toMatchObject({ ok: false, reason: 'wrong-code' })
    expect(await otp.verify('nope', '123456')).toEqual({ ok: false, reason: 'not-found' })
  })
})
