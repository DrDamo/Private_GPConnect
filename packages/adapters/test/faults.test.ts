import { describe, expect, it } from 'vitest'
import { AdapterError, InMemoryFaultSource, MockNhsLogin, MockPds, withFaults } from '../src'

describe('withFaults', () => {
  it('passes calls through when no fault is set', async () => {
    const pds = withFaults('pds', new MockPds(), ['getPatient', 'search'], new InMemoryFaultSource())
    expect((await pds.getPatient('9990000018')).nhsNumber).toBe('9990000018')
  })

  it.each([
    ['timeout', true],
    ['unavailable', true],
  ] as const)('injects %s as a retryable AdapterError', async (kind, retryable) => {
    const faults = new InMemoryFaultSource()
    const pds = withFaults('pds', new MockPds(), ['getPatient', 'search'], faults)
    faults.set('pds', { kind })
    await expect(pds.getPatient('9990000018')).rejects.toSatisfy(
      (e: unknown) => e instanceof AdapterError && e.code === kind && e.retryable === retryable,
    )
    faults.set('pds', null)
    await expect(pds.getPatient('9990000018')).resolves.toBeDefined()
  })

  it('adds latency', async () => {
    const faults = new InMemoryFaultSource()
    faults.set('pds', { kind: 'latency', ms: 50 })
    const pds = withFaults('pds', new MockPds(), ['getPatient'], faults)
    const start = Date.now()
    await pds.getPatient('9990000018')
    expect(Date.now() - start).toBeGreaterThanOrEqual(45)
  })

  it('only affects the targeted adapter and leaves sync methods alone', async () => {
    const faults = new InMemoryFaultSource()
    faults.set('pds', { kind: 'unavailable' })
    const login = withFaults('nhs-login', new MockNhsLogin({ signingKey: 'k' }), ['exchangeCode'], faults)
    expect(login.authorizationUrl({ state: 's', nonce: 'n', redirectUri: '/cb' })).toContain('state=s')
    faults.set('nhs-login', { kind: 'timeout' })
    await expect(login.exchangeCode({ code: 'x', redirectUri: '/cb', nonce: 'n' })).rejects.toBeInstanceOf(AdapterError)
  })

  it('refuses to wrap something that is not a method', () => {
    expect(() => withFaults('pds', { x: 1 } as never, ['x' as never], new InMemoryFaultSource())).toThrow()
  })
})
