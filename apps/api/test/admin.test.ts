import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { InMemoryAuditStore } from '@pgpc/core'
import { buildApp } from '../src/app'
import { createServices } from '../src/services'
import { Browser, patientGrants } from './helpers'

let app: FastifyInstance

beforeEach(async () => {
  app = await buildApp({ services: createServices({}) })
  return () => app.close()
})

async function admin(userId: 'sim-admin-auditor' | 'sim-admin-operator') {
  const b = new Browser(app)
  expect((await b.post('/api/admin/sim-login', { userId })).statusCode).toBe(200)
  return b
}

async function someActivity() {
  const provider = new Browser(app)
  await provider.post('/api/provider/sim-login', { userId: 'sim-user-ph-pharm' })
  const consentId = (await provider.post('/api/provider/consent-requests', { nhsNumber: '9990000050', purpose: 'Checking interactions' })).json().consent.id
  await patientGrants(app, consentId, 'sim-nhslogin-0005')
  await provider.get(`/api/provider/consents/${consentId}/html/MED`)
  await provider.get(`/api/provider/consents/${consentId}/html/ENC`) // denied: not in the pharmacy profile
  return { provider, consentId }
}

describe('admin console API', () => {
  it('requires sign-in', async () => {
    for (const url of ['/api/admin/overview', '/api/admin/audit', '/api/admin/consents', '/api/admin/faults']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    }
  })

  it('overview counts consents by status and recent denials', async () => {
    await someActivity()
    const body = (await (await admin('sim-admin-auditor')).get('/api/admin/overview')).json()
    expect(body.consents.active).toBe(1)
    expect(body.audit.recentDenied).toBe(1)
    expect(body.audit.recentRecordAccess).toBe(1)
  })

  it('audit trail: newest first, filterable, with readable actors and no NHS numbers', async () => {
    const { consentId } = await someActivity()
    const a = await admin('sim-admin-auditor')
    const all = (await a.get('/api/admin/audit?limit=100')).json() as Array<{ seq: number; type: string; actor: string }>
    expect(all[0].seq).toBeGreaterThan(all[1].seq)
    expect(JSON.stringify(all)).not.toContain('9990000050')
    const denied = (await a.get('/api/admin/audit?type=access.&outcome=denied')).json()
    expect(denied).toEqual([
      expect.objectContaining({
        type: 'access.html.view',
        outcome: 'denied',
        actor: 'Priya Desai (Pharmacist), Northern Online Pharmacy (simulated)',
        consentId,
        details: expect.objectContaining({ reasons: ['html-section-not-consented'] }),
      }),
    ])
    const page2 = (await a.get(`/api/admin/audit?limit=3&beforeSeq=${all[2].seq}`)).json() as Array<{ seq: number }>
    expect(page2[0].seq).toBe(all[3].seq)
  })

  it('searching by NHS number finds that patient only, and the search is itself audited', async () => {
    await someActivity()
    const a = await admin('sim-admin-auditor')
    const found = (await a.get('/api/admin/audit?nhsNumber=9990000050&limit=200')).json() as Array<{ type: string }>
    expect(found.length).toBeGreaterThan(3)
    expect((await a.get('/api/admin/audit?nhsNumber=9990000018')).json()).toEqual([])
    // Each view is recorded after its own query, so this one sees the two searches.
    const views = (await a.get('/api/admin/audit?type=admin.audit.view')).json()
    expect(views).toHaveLength(2)
    expect(views[0].actor).toBe('Alex Reed (IG auditor)')
    expect(views.every((v: { patientRef: string | null }) => v.patientRef)).toBe(true)
  })

  it("the patient can see that service staff reviewed their record's access log", async () => {
    await someActivity()
    await (await admin('sim-admin-auditor')).get('/api/admin/audit?nhsNumber=9990000050')
    const patient = new Browser(app)
    const { signInWithNhsLogin } = await import('./helpers')
    await signInWithNhsLogin(patient, 'sim-nhslogin-0005')
    const log = ((await patient.get('/api/patient/me/access-log')).json() as Array<{ description: string }>).map(e => e.description)
    expect(log).toContain('Staff running this service reviewed the log of access to your record')
  })

  it('verifies the chain, and detects tampering', async () => {
    await someActivity()
    const a = await admin('sim-admin-auditor')
    expect((await a.get('/api/admin/audit/verify')).json()).toMatchObject({ valid: true })
    // Tamper below the application (the in-memory store stands in for the database).
    const store = (app.services.audit as unknown as { store: InMemoryAuditStore }).store
    store.unsafeEvents()[2].outcome = 'denied'
    expect((await a.get('/api/admin/audit/verify')).json()).toMatchObject({ valid: false, seq: 3, problem: 'hash-mismatch' })
  })

  it('consent register masks NHS numbers and filters by effective status', async () => {
    await someActivity()
    const reg = (await (await admin('sim-admin-auditor')).get('/api/admin/consents?status=active')).json()
    expect(reg).toEqual([expect.objectContaining({ status: 'active', patient: '*** *** 0050', assurance: 'nhs-login-p9' })])
  })

  it('fault injection: operators only, takes effect, and is audited', async () => {
    const { provider, consentId } = await someActivity()
    const auditor = await admin('sim-admin-auditor')
    expect((await auditor.put('/api/admin/faults/gp-connect', { kind: 'timeout' })).statusCode).toBe(403)

    const operator = await admin('sim-admin-operator')
    expect((await operator.put('/api/admin/faults/gp-connect', { kind: 'timeout' })).json()).toEqual({ adapter: 'gp-connect', fault: { kind: 'timeout' } })
    expect((await provider.get(`/api/provider/consents/${consentId}/html/MED`)).statusCode).toBe(504)
    const faults = (await operator.get('/api/admin/faults')).json()
    expect(faults).toContainEqual({ adapter: 'gp-connect', fault: { kind: 'timeout' } })

    await operator.put('/api/admin/faults/gp-connect', { kind: 'none' })
    expect((await provider.get(`/api/provider/consents/${consentId}/html/MED`)).statusCode).toBe(200)
    const changes = (await operator.get('/api/admin/audit?type=admin.fault.set')).json()
    expect(changes.map((c: { details: { kind: string } }) => c.details.kind)).toEqual(['none', 'timeout'])
  })
})
