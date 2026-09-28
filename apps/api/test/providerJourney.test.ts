import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { createServices } from '../src/services'
import { Browser, patientGrants } from './helpers'

let app: FastifyInstance

beforeEach(async () => {
  app = await buildApp({ services: createServices({}) })
  return () => app.close()
})

async function signInProvider(userId: string) {
  const browser = new Browser(app)
  const res = await browser.post('/api/provider/sim-login', { userId })
  return { browser, res }
}

async function requestAndGrant(browser: Browser, nhsNumber: string, sub: string) {
  const req = await browser.post('/api/provider/consent-requests', { nhsNumber, purpose: 'Assessment before supplying medicine' })
  expect(req.statusCode).toBe(201)
  const consentId = req.json().consent.id as string
  const patient = await patientGrants(app, consentId, sub)
  return { consentId, patient }
}

describe('provider sign-in (simulated)', () => {
  it('signs in, reports the session, and signs out', async () => {
    const { browser, res } = await signInProvider('sim-user-ph-pharm')
    expect(res.statusCode).toBe(200)
    expect((await browser.get('/api/provider/session')).json()).toMatchObject({
      user: { name: 'Priya Desai (Pharmacist)', role: 'clinician' },
      organisation: { odsCode: 'SIMPH1', typeLabel: 'Pharmacy', active: true },
    })
    await browser.post('/api/provider/logout')
    expect((await browser.get('/api/provider/session')).statusCode).toBe(401)
  })

  it('accepts the token as a Bearer token for API clients', async () => {
    const { res } = await signInProvider('sim-user-ph-pharm')
    const session = await app.inject({ method: 'GET', url: '/api/provider/session', headers: { authorization: `Bearer ${res.json().token}` } })
    expect(session.statusCode).toBe(200)
  })

  it('refuses a disabled account', async () => {
    expect((await signInProvider('sim-user-wm-left')).res.statusCode).toBe(403)
  })

  it('rejects a forged token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/provider/session', headers: { authorization: 'Bearer eyJ1c2VySWQiOiJ4In0.forged' } })
    expect(res.statusCode).toBe(401)
  })

  it('never lets clinical responses be cached', async () => {
    const { browser } = await signInProvider('sim-user-ph-pharm')
    expect((await browser.get('/api/provider/patients/9990000018')).headers['cache-control']).toBe('no-store')
  })
})

describe('finding a patient', () => {
  it('by NHS number: returns only identity details, practice, GP Connect status and consents', async () => {
    const { browser } = await signInProvider('sim-user-ph-pharm')
    const body = (await browser.get('/api/provider/patients/9990000018')).json()
    expect(body.patient).toEqual({
      nhsNumber: '9990000018',
      restricted: false,
      name: 'Mrs Sarah Jane THOMPSON',
      birthDate: '1984-03-12',
      age: expect.any(Number),
      gender: 'female',
      deceased: false,
      gp: { odsCode: 'SIMGP1', name: 'Riverside Medical Practice (simulated)' },
      eligible: true,
      ineligibleReasons: [],
    })
    expect(body.gpConnect).toBe('available')
    expect(body.consents).toEqual([])
    expect(JSON.stringify(body)).not.toContain('07700900001') // no mobile
  })

  it('an S-flag patient: nothing beyond the NHS number', async () => {
    const { browser } = await signInProvider('sim-user-ph-pharm')
    const body = (await browser.get('/api/provider/patients/9990000069')).json()
    expect(body.patient).toEqual({ nhsNumber: '9990000069', restricted: true, eligible: false, ineligibleReasons: ['patient-restricted'] })
  })

  it('by demographics: ambiguous → add postcode', async () => {
    const { browser } = await signInProvider('sim-user-ph-pharm')
    const ambiguous = await browser.get('/api/provider/patients?family=Smith&birthDate=1985-02-14')
    expect(ambiguous.statusCode).toBe(422)
    expect(ambiguous.json().error).toBe('too-many-matches')
    const found = await browser.get('/api/provider/patients?family=Smith&birthDate=1985-02-14&postalCode=LS9%200YZ')
    expect(found.json().patient.nhsNumber).toBe('9990000158')
    expect((await browser.get('/api/provider/patients?family=Nobody&birthDate=1985-02-14')).statusCode).toBe(404)
  })

  it('shows when the practice is not on GP Connect', async () => {
    const { browser } = await signInProvider('sim-user-ph-pharm')
    expect((await browser.get('/api/provider/patients/9990000107')).json().gpConnect).toBe('not-enabled')
  })

  it('is not available to provider admins', async () => {
    const { browser } = await signInProvider('sim-user-ph-admin')
    expect((await browser.get('/api/provider/patients/9990000018')).statusCode).toBe(403)
  })
})

describe('viewing the GP record (HTML)', () => {
  it('is denied until the patient agrees, then allowed for consented sections only, and every view is logged for the patient', async () => {
    const { browser } = await signInProvider('sim-user-ph-pharm')
    const req = await browser.post('/api/provider/consent-requests', { nhsNumber: '9990000050', purpose: 'Checking interactions before supply' })
    const consentId = req.json().consent.id

    const early = await browser.get(`/api/provider/consents/${consentId}/html/SUM`)
    expect(early.statusCode).toBe(403)
    expect(early.json()).toMatchObject({ error: 'access-denied', reasons: ['consent-not-active'] })

    const patient = await patientGrants(app, consentId, 'sim-nhslogin-0005')

    const med = await browser.get(`/api/provider/consents/${consentId}/html/MED`)
    expect(med.statusCode).toBe(200)
    const body = med.json()
    expect(body).toMatchObject({ section: 'MED', title: 'Medications', placeholder: true, practice: { odsCode: 'SIMGP2', supplier: 'TPP' } })
    expect(body.html).toContain('Warfarin 1mg tablets')
    expect(body.exchange.headers['Ssp-InteractionID']).toContain('gpc.getcarerecord')
    expect(body.exchange.jwtClaims.requesting_organization.identifier[0].value).toBe('SIMPH1')

    // Pharmacy profile covers SUM/MED/ALL only.
    const enc = await browser.get(`/api/provider/consents/${consentId}/html/ENC`)
    expect(enc.statusCode).toBe(403)
    expect(enc.json().reasons).toEqual(['html-section-not-consented'])
    expect((await browser.get(`/api/provider/consents/${consentId}/html/XYZ`)).statusCode).toBe(400)

    const log = (await patient.get('/api/patient/me/access-log')).json() as Array<{ description: string }>
    const descriptions = log.map(e => e.description)
    expect(descriptions).toContain('Northern Online Pharmacy (simulated) looked at your medicines')
    expect(descriptions).toContain('Northern Online Pharmacy (simulated) tried to look at your consultations but was not allowed')

    // Withdrawal takes effect immediately.
    await patient.post(`/api/patient/consents/${consentId}/withdraw`, {})
    const after = await browser.get(`/api/provider/consents/${consentId}/html/MED`)
    expect(after.json().reasons).toEqual(['consent-not-active'])

    expect((await app.services.audit.verify()).valid).toBe(true)
  })

  it("cannot see another organisation's consent", async () => {
    const { browser } = await signInProvider('sim-user-ph-pharm')
    const { consentId } = await requestAndGrant(browser, '9990000018', 'sim-nhslogin-0001')
    const other = await signInProvider('sim-user-wm-doc')
    expect((await other.browser.get(`/api/provider/consents/${consentId}/html/SUM`)).statusCode).toBe(404)
    expect((await other.browser.get(`/api/provider/consents/${consentId}`)).statusCode).toBe(404)
  })

  it('a provider admin is denied (and the denial is audited)', async () => {
    const { browser } = await signInProvider('sim-user-ph-pharm')
    const { consentId } = await requestAndGrant(browser, '9990000018', 'sim-nhslogin-0001')
    const admin = await signInProvider('sim-user-ph-admin')
    const res = await admin.browser.get(`/api/provider/consents/${consentId}/html/SUM`)
    expect(res.statusCode).toBe(403)
    expect(res.json().reasons).toEqual(['actor-role-not-permitted'])
  })

  it('explains when the practice is not on GP Connect', async () => {
    const { browser } = await signInProvider('sim-user-ph-pharm')
    const { consentId } = await requestAndGrant(browser, '9990000107', 'sim-nhslogin-0010')
    const res = await browser.get(`/api/provider/consents/${consentId}/html/SUM`)
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('gp-connect-not-enabled')
  })

  it('reports a GP system timeout as retryable', async () => {
    const { browser } = await signInProvider('sim-user-ph-pharm')
    const { consentId } = await requestAndGrant(browser, '9990000018', 'sim-nhslogin-0001')
    app.services.simulator.faults.set('gp-connect', { kind: 'timeout' })
    const res = await browser.get(`/api/provider/consents/${consentId}/html/SUM`)
    expect(res.statusCode).toBe(504)
    expect(res.json()).toMatchObject({ error: 'gp-connect-timeout', retryable: true })
  })

  it('shows the confidential-items banner and withholds the items', async () => {
    const { browser } = await signInProvider('sim-user-ph-pharm')
    const { consentId } = await requestAndGrant(browser, '9990000123', 'sim-nhslogin-0012')
    const html = (await browser.get(`/api/provider/consents/${consentId}/html/SUM`)).json().html as string
    expect(html).toContain('Items excluded due to confidentiality')
    expect(html).not.toContain('Termination')
  })
})

describe('consent management by the provider', () => {
  it('lists consents with patient names and can end access early', async () => {
    const { browser } = await signInProvider('sim-user-ph-pharm')
    const { consentId } = await requestAndGrant(browser, '9990000018', 'sim-nhslogin-0001')
    const list = (await browser.get('/api/provider/consents')).json()
    expect(list).toEqual([expect.objectContaining({ id: consentId, status: 'active', patientName: 'Mrs Sarah Jane THOMPSON' })])
    const ended = await browser.post(`/api/provider/consents/${consentId}/cancel`, { reason: 'Episode complete' })
    expect(ended.json()).toMatchObject({ status: 'withdrawn', withdrawal: { by: 'provider', reason: 'Episode complete' } })
    expect((await browser.get('/api/provider/consents?status=active')).json()).toEqual([])
  })

  it('a suspended organisation cannot request consent', async () => {
    const { browser } = await signInProvider('sim-user-ph9-pharm')
    const res = await browser.post('/api/provider/consent-requests', { nhsNumber: '9990000018', purpose: 'Assessment before supply' })
    expect(res.statusCode).toBe(403)
  })
})
