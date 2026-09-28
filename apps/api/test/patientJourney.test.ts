import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { createServices } from '../src/services'
import { Browser as BrowserBase, createRequest as createRequestFor, latestSms as latestSmsFor, signInWithNhsLogin } from './helpers'

// End-to-end patient journeys through the HTTP API, with a small cookie jar,
// exactly as the web app drives them.

let app: FastifyInstance

class Browser extends BrowserBase {
  constructor() {
    super(app)
  }
}
const createRequest = (userId: string, nhsNumber: string) => createRequestFor(app, userId, nhsNumber)
const latestSms = (mobile: string) => latestSmsFor(app, mobile)

beforeEach(async () => {
  app = await buildApp({ services: createServices({}) })
  return () => app.close()
})

describe('consent request (provider side, via the demo launcher)', () => {
  it('creates a pending request and texts the PDS mobile without naming the provider', async () => {
    const res = await createRequest('sim-user-mc-doc', '9990000042')
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body).toMatchObject({ status: 'pending', notification: { sent: true, to: '07*** ***004' } })
    const sms = await latestSms('07700900004')
    expect(sms).toContain(`/patient/consent/${body.consentId}`)
    expect(sms.toLowerCase()).not.toContain('cannabis')
  })

  it.each([
    ['9990000069', 'patient-restricted'],
    ['9990000077', 'patient-deceased'],
    ['9990000085', 'patient-under-16'],
  ])('refuses ineligible patient %s (%s)', async (nhs, reason) => {
    const res = await createRequest('sim-user-ph-pharm', nhs)
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ error: 'patient-ineligible', reasons: [reason] })
  })

  it.each([
    ['sim-user-ph-admin', 'provider admin'],
    ['sim-user-wm-left', 'inactive user'],
    ['sim-user-ph9-pharm', 'suspended organisation'],
  ])('refuses %s (%s)', async userId => {
    expect((await createRequest(userId, '9990000018')).statusCode).toBe(403)
  })

  it('still creates the request when the patient has no mobile, and says so', async () => {
    const res = await createRequest('sim-user-ph-pharm', '9990000093')
    expect(res.json().notification).toEqual({ sent: false, reason: 'no-mobile' })
  })

  it('404s an unknown NHS number', async () => {
    expect((await createRequest('sim-user-ph-pharm', '9990000204')).statusCode).toBe(404)
  })
})

describe('patient journey: NHS login', () => {
  it('reviews, agrees, sees the log, and withdraws', async () => {
    const { consentId } = (await createRequest('sim-user-ph-pharm', '9990000018')).json()
    const browser = new Browser()

    // Nothing is revealed before sign-in.
    expect((await browser.get(`/api/patient/consents/${consentId}`)).statusCode).toBe(401)

    const cb = await signInWithNhsLogin(browser, 'sim-nhslogin-0001', `/patient/consent/${consentId}`)
    expect(cb.statusCode).toBe(200)
    expect(cb.json()).toEqual({ returnTo: `/patient/consent/${consentId}` })
    expect((await browser.get('/api/patient/session')).json()).toMatchObject({
      authenticated: true,
      assurance: 'nhs-login-p9',
      name: 'Mrs Sarah Jane THOMPSON',
    })

    const view = (await browser.get(`/api/patient/consents/${consentId}`)).json()
    expect(view).toMatchObject({ status: 'pending', narrowedBySignIn: false, durationDays: 90 })
    expect(view.provider.name).toBe('Northern Online Pharmacy (simulated)')
    expect(view.permissions).toHaveLength(3)
    expect(view.consentText).toContain('Northern Online Pharmacy (simulated) has asked to see your GP record.')

    const granted = await browser.post(`/api/patient/consents/${consentId}/decision`, {
      decision: 'grant',
      consentTextVersion: view.consentTextVersion,
      consentTextHash: view.consentTextHash,
    })
    expect(granted.statusCode).toBe(200)
    expect(granted.json()).toMatchObject({ status: 'active', decision: { outcome: 'granted', via: 'nhs-login' } })
    expect(granted.json().consentText).toBeUndefined()

    const mine = (await browser.get('/api/patient/me/consents')).json()
    expect(mine.map((c: { id: string }) => c.id)).toEqual([consentId])

    const log = (await browser.get('/api/patient/me/access-log')).json() as Array<{ description: string }>
    const descriptions = log.map(e => e.description)
    expect(descriptions).toEqual(
      expect.arrayContaining([
        'Northern Online Pharmacy (simulated) asked for your consent to see your GP record',
        'We sent you a text message about a request from Northern Online Pharmacy (simulated)',
        'Signed in with NHS login',
        "You agreed to Northern Online Pharmacy (simulated)'s request",
      ]),
    )

    const withdrawn = await browser.post(`/api/patient/consents/${consentId}/withdraw`, { reason: 'changed my mind' })
    expect(withdrawn.json()).toMatchObject({ status: 'withdrawn', withdrawal: { by: 'patient' } })
    expect(((await browser.get('/api/patient/me/access-log')).json() as Array<{ description: string }>)[0].description).toBe(
      'You withdrew consent from Northern Online Pharmacy (simulated)',
    )

    await browser.post('/api/patient/logout')
    expect((await browser.get('/api/patient/session')).json()).toEqual({ authenticated: false })
    expect((await app.services.audit.verify()).valid).toBe(true)
  })

  it('can decline', async () => {
    const { consentId } = (await createRequest('sim-user-ph-pharm', '9990000018')).json()
    const browser = new Browser()
    await signInWithNhsLogin(browser, 'sim-nhslogin-0001')
    const view = (await browser.get(`/api/patient/consents/${consentId}`)).json()
    const res = await browser.post(`/api/patient/consents/${consentId}/decision`, {
      decision: 'decline',
      consentTextVersion: view.consentTextVersion,
      consentTextHash: view.consentTextHash,
    })
    expect(res.json().status).toBe('declined')
  })

  it("does not reveal another patient's request", async () => {
    const { consentId } = (await createRequest('sim-user-ph-pharm', '9990000018')).json()
    const browser = new Browser()
    await signInWithNhsLogin(browser, 'sim-nhslogin-0002')
    expect((await browser.get(`/api/patient/consents/${consentId}`)).statusCode).toBe(404)
    expect((await browser.get('/api/patient/consents/not-a-uuid')).statusCode).toBe(404)
  })

  it('refuses a P5 (unverified) NHS login', async () => {
    const res = await signInWithNhsLogin(new Browser(), 'sim-nhslogin-0013')
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('identity-not-verified')
  })

  it('refuses a callback whose state does not match the browser that started sign-in', async () => {
    const attacker = new Browser()
    const start = await attacker.post('/api/patient/nhs-login/start', { returnTo: '/patient' })
    const authUrl = new URL(start.json().authorizationUrl, 'http://x')
    const authorize = await attacker.post('/api/sim/nhs-login/authorize', {
      sub: 'sim-nhslogin-0001',
      state: authUrl.searchParams.get('state'),
      nonce: authUrl.searchParams.get('nonce'),
      redirectUri: '/patient/callback',
    })
    const back = new URL(authorize.json().location, 'http://x')
    // A victim's browser is sent the attacker's callback link (login CSRF).
    const victim = new Browser()
    const res = await victim.post('/api/patient/nhs-login/callback', { code: back.searchParams.get('code'), state: back.searchParams.get('state') })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('sign-in-expired')
  })

  it('rejects an open redirect in returnTo', async () => {
    expect((await new Browser().post('/api/patient/nhs-login/start', { returnTo: '//evil.example' })).statusCode).toBe(400)
  })

  it('refuses a decision on out-of-date wording', async () => {
    const { consentId } = (await createRequest('sim-user-ph-pharm', '9990000018')).json()
    const browser = new Browser()
    await signInWithNhsLogin(browser, 'sim-nhslogin-0001')
    const res = await browser.post(`/api/patient/consents/${consentId}/decision`, {
      decision: 'grant',
      consentTextVersion: '2026-09-v1',
      consentTextHash: 'b'.repeat(64),
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('text-changed')
  })
})

describe('patient journey: text message code', () => {
  async function smsSignIn(browser: Browser, consentId: string, mobile: string, birthDate: string) {
    const start = await browser.post('/api/patient/sms/start', { consentId })
    expect(start.statusCode).toBe(200)
    const code = /code is (\d{6})/.exec(await latestSms(mobile))![1]
    return { start, code, verify: (c = code, dob = birthDate) => browser.post('/api/patient/sms/verify', { challengeId: start.json().challengeId, code: c, birthDate: dob }) }
  }

  it('signs in with code + date of birth, and can only agree to viewing for 30 days', async () => {
    const { consentId } = (await createRequest('sim-user-wm-doc', '9990000034')).json()
    const browser = new Browser()
    const { start, verify } = await smsSignIn(browser, consentId, '07700900003', '1990-07-25')
    expect(start.json().sentTo).toBe('07*** ***003')

    const wrongDob = await verify(undefined, '1990-07-26')
    expect(wrongDob.statusCode).toBe(400)
    expect(wrongDob.json()).toMatchObject({ error: 'code-wrong-code', attemptsLeft: 4 })

    expect((await verify()).json()).toEqual({ ok: true, consentId })
    expect((await browser.get('/api/patient/session')).json()).toMatchObject({ assurance: 'sms-otp', consentId })

    const view = (await browser.get(`/api/patient/consents/${consentId}`)).json()
    expect(view).toMatchObject({ narrowedBySignIn: true, durationDays: 30, permissions: ['Look at parts of your GP record'] })
    const granted = await browser.post(`/api/patient/consents/${consentId}/decision`, {
      decision: 'grant',
      consentTextVersion: view.consentTextVersion,
      consentTextHash: view.consentTextHash,
    })
    expect(granted.json()).toMatchObject({ status: 'active', decision: { via: 'sms' }, durationDays: 30 })
    const stored = await app.services.consentRepository.get(consentId)
    expect(stored?.scope.actions).toEqual(['html.view'])

    // A text-message session is limited to this one request.
    expect((await browser.get('/api/patient/me/consents')).statusCode).toBe(403)
    const other = (await createRequest('sim-user-ph-pharm', '9990000034')).json()
    expect((await browser.get(`/api/patient/consents/${other.consentId}`)).statusCode).toBe(404)
  })

  it('a code cannot be reused', async () => {
    const { consentId } = (await createRequest('sim-user-ph-pharm', '9990000018')).json()
    const browser = new Browser()
    const { verify } = await smsSignIn(browser, consentId, '07700900001', '1984-03-12')
    expect((await verify()).statusCode).toBe(200)
    expect((await verify()).json().error).toBe('code-consumed')
  })

  it('refuses when there is no mobile on PDS', async () => {
    const { consentId } = (await createRequest('sim-user-ph-pharm', '9990000093')).json()
    const res = await new Browser().post('/api/patient/sms/start', { consentId })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('no-mobile')
  })

  it('limits how many codes can be sent', async () => {
    const { consentId } = (await createRequest('sim-user-ph-pharm', '9990000018')).json()
    const browser = new Browser()
    for (let i = 0; i < 3; i++) expect((await browser.post('/api/patient/sms/start', { consentId })).statusCode).toBe(200)
    expect((await browser.post('/api/patient/sms/start', { consentId })).statusCode).toBe(429)
  })

  it('will not send codes for a request that is no longer open', async () => {
    const { consentId } = (await createRequest('sim-user-ph-pharm', '9990000018')).json()
    const browser = new Browser()
    await signInWithNhsLogin(browser, 'sim-nhslogin-0001')
    const view = (await browser.get(`/api/patient/consents/${consentId}`)).json()
    await browser.post(`/api/patient/consents/${consentId}/decision`, { decision: 'decline', consentTextVersion: view.consentTextVersion, consentTextHash: view.consentTextHash })
    expect((await new Browser().post('/api/patient/sms/start', { consentId })).statusCode).toBe(409)
  })
})
