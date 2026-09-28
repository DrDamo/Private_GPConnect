import { describe, expect, it } from 'vitest'
import { AdapterError, MockNhsLogin, nhsLoginPersonas, signToken } from '../src'

const NOW = new Date('2026-10-01T09:00:00Z')
const REDIRECT = '/patient/callback'

function setup(clock = () => NOW) {
  return new MockNhsLogin({ signingKey: 'test-key', clock })
}

const flow = (login: MockNhsLogin, sub = 'sim-nhslogin-0001') => {
  const location = login.issueCode({ sub, nonce: 'n-1', redirectUri: REDIRECT, state: 's-1' })
  const url = new URL(location, 'http://x')
  return { code: url.searchParams.get('code')!, state: url.searchParams.get('state'), path: url.pathname }
}

const rejects = (p: Promise<unknown>) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof AdapterError && e.code === 'unauthorised')

describe('MockNhsLogin', () => {
  it('builds an authorisation URL pointing at the simulator, carrying state and nonce', () => {
    const url = new URL(setup().authorizationUrl({ state: 's', nonce: 'n', redirectUri: REDIRECT }), 'http://x')
    expect(url.pathname).toBe('/sim/nhs-login')
    expect(url.searchParams.get('state')).toBe('s')
    expect(url.searchParams.get('nonce')).toBe('n')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
  })

  it('redirects back with code and state, and exchanges the code for P9 claims', async () => {
    const login = setup()
    const { code, state, path } = flow(login)
    expect(path).toBe(REDIRECT)
    expect(state).toBe('s-1')
    expect(await login.exchangeCode({ code, redirectUri: REDIRECT, nonce: 'n-1' })).toEqual({
      sub: 'sim-nhslogin-0001',
      identityProofingLevel: 'P9',
      nonce: 'n-1',
      nhsNumber: '9990000018',
      givenName: 'Sarah',
      familyName: 'Thompson',
      birthDate: '1984-03-12',
    })
  })

  it('releases no NHS number for a P5 account', async () => {
    const login = setup()
    const identity = await login.exchangeCode({ code: flow(login, 'sim-nhslogin-0013').code, redirectUri: REDIRECT, nonce: 'n-1' })
    expect(identity.identityProofingLevel).toBe('P5')
    expect(identity.nhsNumber).toBeUndefined()
  })

  it('rejects a wrong redirect URI or nonce', async () => {
    const login = setup()
    const { code } = flow(login)
    await rejects(login.exchangeCode({ code, redirectUri: '/elsewhere', nonce: 'n-1' }))
    await rejects(login.exchangeCode({ code, redirectUri: REDIRECT, nonce: 'other' }))
  })

  it('rejects an expired code', async () => {
    let now = NOW
    const login = setup(() => now)
    const { code } = flow(login)
    now = new Date(NOW.getTime() + 5 * 60 * 1000)
    await rejects(login.exchangeCode({ code, redirectUri: REDIRECT, nonce: 'n-1' }))
  })

  it('rejects a forged or tampered code', async () => {
    const login = setup()
    const forged = signToken({ sub: 'sim-nhslogin-0001', nonce: 'n-1', redirectUri: REDIRECT, exp: NOW.getTime() + 60_000 }, 'wrong-key')
    await rejects(login.exchangeCode({ code: forged, redirectUri: REDIRECT, nonce: 'n-1' }))
    const { code } = flow(login)
    await rejects(login.exchangeCode({ code: code.slice(0, -2) + 'xx', redirectUri: REDIRECT, nonce: 'n-1' }))
    await rejects(login.exchangeCode({ code: 'not-a-token', redirectUri: REDIRECT, nonce: 'n-1' }))
  })

  it('refuses to issue a code for an unknown persona', () => {
    expect(() => setup().issueCode({ sub: 'nobody', nonce: 'n', redirectUri: REDIRECT, state: 's' })).toThrow(AdapterError)
  })

  it('lists personas for the picker, with their proofing level', () => {
    const personas = nhsLoginPersonas()
    expect(personas.find(p => p.sub === 'sim-nhslogin-0013')?.identityProofingLevel).toBe('P5')
    expect(personas.some(p => p.nhsNumber === '9990000093')).toBe(false) // no NHS login account
  })
})
