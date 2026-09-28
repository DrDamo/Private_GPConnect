import { describe, expect, it } from 'vitest'
import {
  AuditLog,
  buildEvent,
  canonicalJson,
  GENESIS_HASH,
  hashEvent,
  InMemoryAuditStore,
  pseudonymiseNhsNumber,
} from '../src'
import { auditStoreContract } from '../testing/contracts'
import { NHS_NUMBER, NOW, OTHER_NHS_NUMBER } from './helpers'

auditStoreContract('in-memory', async () => new InMemoryAuditStore())

describe('canonicalJson', () => {
  it('is independent of key order at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 3 } })).toBe('{"a":{"c":3,"d":[{"y":2,"z":1}]},"b":1}')
  })
})

describe('buildEvent / hashEvent', () => {
  const input = {
    type: 'x',
    outcome: 'success' as const,
    actor: { type: 'system' as const, id: 's' },
    correlationId: 'c',
  }

  it('starts from the genesis hash', () => {
    const e = buildEvent(input, null, { id: 'e1', recordedAt: NOW.toISOString() })
    expect(e.seq).toBe(1)
    expect(e.prevHash).toBe(GENESIS_HASH)
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes if any field changes', () => {
    const e = buildEvent(input, null, { id: 'e1', recordedAt: NOW.toISOString() })
    const { hash, ...rest } = e
    expect(hashEvent(rest)).toBe(hash)
    expect(hashEvent({ ...rest, outcome: 'denied' })).not.toBe(hash)
    expect(hashEvent({ ...rest, actor: { ...rest.actor, id: 't' } })).not.toBe(hash)
  })
})

describe('pseudonymiseNhsNumber', () => {
  it('is deterministic per key, ignores spaces, and differs across keys and patients', () => {
    const a = pseudonymiseNhsNumber(NHS_NUMBER, 'k1')
    expect(pseudonymiseNhsNumber('969 213 6701', 'k1')).toBe(a)
    expect(pseudonymiseNhsNumber(NHS_NUMBER, 'k2')).not.toBe(a)
    expect(pseudonymiseNhsNumber(OTHER_NHS_NUMBER, 'k1')).not.toBe(a)
    expect(a).not.toContain(NHS_NUMBER)
  })
})

describe('AuditLog', () => {
  const setup = () => {
    const store = new InMemoryAuditStore()
    let n = 0
    const log = new AuditLog(store, { pseudonymKey: 'test-key', clock: () => NOW, newId: () => `id-${++n}` })
    return { store, log }
  }

  it('requires a pseudonym key', () => {
    expect(() => new AuditLog(new InMemoryAuditStore(), { pseudonymKey: '' })).toThrow()
  })

  it('never stores the NHS number in clear', async () => {
    const { store, log } = setup()
    await log.record({ type: 'pds.search', outcome: 'success', actor: { type: 'system', id: 's' }, correlationId: 'c', nhsNumber: NHS_NUMBER })
    expect(JSON.stringify(store.unsafeEvents())).not.toContain(NHS_NUMBER)
    expect(store.unsafeEvents()[0].patientRef).toBe(pseudonymiseNhsNumber(NHS_NUMBER, 'test-key'))
  })

  it("returns a patient's own events only", async () => {
    const { log } = setup()
    for (const nhsNumber of [NHS_NUMBER, OTHER_NHS_NUMBER, NHS_NUMBER]) {
      await log.record({ type: 't', outcome: 'success', actor: { type: 'system', id: 's' }, correlationId: 'c', nhsNumber })
    }
    expect((await log.forPatient(NHS_NUMBER)).map(e => e.seq)).toEqual([1, 3])
  })

  describe('verify detects tampering', () => {
    const tampered = async (mutate: (store: InMemoryAuditStore) => void) => {
      const { store, log } = setup()
      for (let i = 0; i < 4; i++) {
        await log.record({ type: 't', outcome: 'success', actor: { type: 'system', id: 's' }, correlationId: `c${i}` })
      }
      expect((await log.verify()).valid).toBe(true)
      mutate(store)
      return log.verify()
    }

    it('an edited event', async () => {
      const result = await tampered(s => {
        s.unsafeEvents()[1].outcome = 'denied'
      })
      expect(result).toEqual({ valid: false, checked: 1, seq: 2, problem: 'hash-mismatch' })
    })

    it('an edited event whose hash was recomputed', async () => {
      const result = await tampered(s => {
        const e = s.unsafeEvents()[1]
        e.outcome = 'denied'
        const { hash: _hash, ...rest } = e
        e.hash = hashEvent(rest)
      })
      expect(result).toEqual({ valid: false, checked: 2, seq: 3, problem: 'broken-link' })
    })

    it('a deleted event', async () => {
      const result = await tampered(s => {
        s.unsafeEvents().splice(2, 1)
      })
      expect(result).toEqual({ valid: false, checked: 2, seq: 3, problem: 'sequence-gap' })
    })
  })
})
