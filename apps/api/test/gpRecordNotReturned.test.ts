import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { createServices } from '../src/services'
import { Browser, patientGrants } from './helpers'

// GP Connect returns PATIENT_NOT_FOUND both when the practice doesn't hold the
// record and when the patient has dissented to sharing there. The two must be
// indistinguishable, must never read as an empty record, and our consent
// never overrides the practice-level choice.

let app: FastifyInstance

beforeEach(async () => {
  app = await buildApp({ services: createServices({}) })
  return () => app.close()
})

async function consentedView(nhsNumber: string, sub: string) {
  const provider = new Browser(app)
  await provider.post('/api/provider/sim-login', { userId: 'sim-user-wm-doc' })
  const consentId = (await provider.post('/api/provider/consent-requests', { nhsNumber, purpose: 'Assessment for weight-loss medication' })).json()
    .consent.id as string
  const patient = await patientGrants(app, consentId, sub)
  const html = await provider.get(`/api/provider/consents/${consentId}/html/SUM`)
  const structured = await provider.get(`/api/provider/consents/${consentId}/structured`)
  return { html, structured, patient, consentId }
}

const cases = [
  ['record not held at the practice', '9990000174', 'sim-nhslogin-0016'],
  ['patient has dissented at the practice', '9990000182', 'sim-nhslogin-0017'],
] as const

describe('the GP system returns no record', () => {
  it.each(cases)('%s: a clear, neutral 404 that does not read as an empty record', async (_, nhsNumber, sub) => {
    const { html, structured } = await consentedView(nhsNumber, sub)
    for (const res of [html, structured]) {
      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body).toMatchObject({ error: 'gp-connect-not-found', gpConnectCode: 'PATIENT_NOT_FOUND', retryable: false })
      expect(body.message).toContain('asked their practice not to share it')
      expect(body.message).toContain('do not assume the patient has no allergies, medicines or conditions')
    }
  })

  it('the provider sees exactly the same response for both causes', async () => {
    const a = await consentedView('9990000174', 'sim-nhslogin-0016')
    const b = await consentedView('9990000182', 'sim-nhslogin-0017')
    expect(a.html.json()).toEqual(b.html.json())
    expect(a.structured.json()).toEqual(b.structured.json())
  })

  it('is audited with the GP Connect code and shown to the patient', async () => {
    const { patient, consentId } = await consentedView('9990000182', 'sim-nhslogin-0017')
    const events = await app.services.audit.forPatient('9990000182')
    const failures = events.filter(e => e.type.startsWith('access.') && e.outcome === 'failure')
    expect(failures.map(e => [e.type, e.details?.gpConnectCode])).toEqual([
      ['access.html.view', 'PATIENT_NOT_FOUND'],
      ['access.structured.retrieve', 'PATIENT_NOT_FOUND'],
    ])
    expect(failures.every(e => e.consentId === consentId)).toBe(true)
    const log = ((await patient.get('/api/patient/me/access-log')).json() as Array<{ description: string }>).map(e => e.description)
    expect(log).toContain("Balance Weight Clinic (simulated) tried to look at your summary, but your GP practice's system did not return your record")
  })

  it("the consent wording tells patients their practice's choice still applies", async () => {
    const provider = new Browser(app)
    await provider.post('/api/provider/sim-login', { userId: 'sim-user-wm-doc' })
    const consentId = (await provider.post('/api/provider/consent-requests', { nhsNumber: '9990000182', purpose: 'Assessment' })).json().consent.id
    const patient = new Browser(app)
    const { signInWithNhsLogin } = await import('./helpers')
    await signInWithNhsLogin(patient, 'sim-nhslogin-0017')
    const view = (await patient.get(`/api/patient/consents/${consentId}`)).json()
    expect(view.consentText).toContain('If you have asked your GP practice not to share your record, that choice still applies')
    expect(view.consentTextVersion).toBe('2026-09-v2')
  })
})
