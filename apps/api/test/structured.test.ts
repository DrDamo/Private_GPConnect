import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { createServices } from '../src/services'
import { Browser, latestSms, patientGrants } from './helpers'

let app: FastifyInstance

beforeEach(async () => {
  app = await buildApp({ services: createServices({}) })
  return () => app.close()
})

async function provider(userId: string) {
  const browser = new Browser(app)
  await browser.post('/api/provider/sim-login', { userId })
  return browser
}

async function consented(userId: string, nhsNumber: string, sub: string) {
  const browser = await provider(userId)
  const req = await browser.post('/api/provider/consent-requests', { nhsNumber, purpose: 'Assessment before prescribing' })
  const consentId = req.json().consent.id as string
  const patient = await patientGrants(app, consentId, sub)
  return { browser, consentId, patient }
}

describe('structured record retrieval', () => {
  it('weight management: returns exactly the consented areas, parsed and as FHIR, and logs it for the patient', async () => {
    const { browser, consentId, patient } = await consented('sim-user-wm-doc', '9990000034', 'sim-nhslogin-0003')
    const res = await browser.get(`/api/provider/consents/${consentId}/structured`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.areas).toEqual(['medications', 'allergies', 'problems', 'uncategorised'])
    expect(Object.keys(body.data).sort()).toEqual(['allergies', 'medications', 'observations', 'problems'])
    expect(body.data.medications.map((m: { drugName: string }) => m.drugName)).toContain('Metformin 500mg tablets')
    expect(body.data.medications.every((m: { dosageInstruction?: string }) => m.dosageInstruction)).toBe(true)
    expect(body.data.problems.map((p: { problem: string }) => p.problem)).toContain('Anorexia nervosa')
    expect(body.bundle.resourceType).toBe('Bundle')
    expect(body.exchange.body.parameter.map((p: { name: string }) => p.name)).toEqual([
      'patientNHSNumber',
      'includeMedication',
      'includeAllergies',
      'includeProblems',
      'includeUncategorisedData',
    ])
    expect(res.headers['cache-control']).toBe('no-store')

    const log = (await patient.get('/api/patient/me/access-log')).json() as Array<{ description: string }>
    expect(log[0].description).toBe(
      'Balance Weight Clinic (simulated) copied these parts of your GP record into their records: Medicines; Allergies; Problems and conditions; Measurements such as weight, BMI and blood pressure',
    )
  })

  it('can be narrowed to fewer areas', async () => {
    const { browser, consentId } = await consented('sim-user-wm-doc', '9990000034', 'sim-nhslogin-0003')
    const body = (await browser.get(`/api/provider/consents/${consentId}/structured?areas=medications`)).json()
    expect(Object.keys(body.data)).toEqual(['medications'])
    expect(body.bundle.entry.some((e: { resource: { resourceType: string } }) => e.resource.resourceType === 'Condition')).toBe(false)
  })

  it('refuses areas outside the consent', async () => {
    const { browser, consentId } = await consented('sim-user-wm-doc', '9990000034', 'sim-nhslogin-0003')
    const res = await browser.get(`/api/provider/consents/${consentId}/structured?areas=medications,consultations`)
    expect(res.statusCode).toBe(403)
    expect(res.json().reasons).toEqual(['clinical-area-not-consented'])
  })

  it('refuses structured data under a text-message (view-only) consent', async () => {
    const browser = await provider('sim-user-ph-pharm')
    const consentId = (await browser.post('/api/provider/consent-requests', { nhsNumber: '9990000050', purpose: 'Checking interactions' })).json().consent.id
    const pat = new Browser(app)
    const start = await pat.post('/api/patient/sms/start', { consentId })
    const code = /code is (\d{6})/.exec(await latestSms(app, '07700900005'))![1]
    await pat.post('/api/patient/sms/verify', { challengeId: start.json().challengeId, code, birthDate: '1950-05-09' })
    const view = (await pat.get(`/api/patient/consents/${consentId}`)).json()
    await pat.post(`/api/patient/consents/${consentId}/decision`, { decision: 'grant', consentTextVersion: view.consentTextVersion, consentTextHash: view.consentTextHash })

    const res = await browser.get(`/api/provider/consents/${consentId}/structured`)
    expect(res.statusCode).toBe(403)
    expect(res.json().reasons).toContain('action-not-consented')
    expect((await browser.get(`/api/provider/consents/${consentId}/html/MED`)).statusCode).toBe(200)
  })

  it('format=bundle returns only the FHIR STU3 Bundle, for provider systems', async () => {
    const { browser, consentId } = await consented('sim-user-ph-pharm', '9990000050', 'sim-nhslogin-0005')
    const res = await browser.get(`/api/provider/consents/${consentId}/structured?format=bundle`)
    expect(res.headers['content-type']).toContain('application/fhir+json')
    const bundle = res.json()
    expect(bundle.resourceType).toBe('Bundle')
    const types = new Set(bundle.entry.map((e: { resource: { resourceType: string } }) => e.resource.resourceType))
    expect(types.has('AllergyIntolerance') && types.has('MedicationStatement')).toBe(true)
    expect(types.has('Condition')).toBe(false)
  })

  it('surfaces the confidential-items warning', async () => {
    const { browser, consentId } = await consented('sim-user-mc-doc', '9990000123', 'sim-nhslogin-0012')
    const body = (await browser.get(`/api/provider/consents/${consentId}/structured`)).json()
    expect(body.warnings).toContainEqual(expect.objectContaining({ list: 'Problems', code: 'confidential-items' }))
    expect(body.data.consultations.length).toBeGreaterThan(0)
  })

  it('rejects a malformed areas parameter', async () => {
    const { browser, consentId } = await consented('sim-user-wm-doc', '9990000034', 'sim-nhslogin-0003')
    expect((await browser.get(`/api/provider/consents/${consentId}/structured?areas=everything`)).statusCode).toBe(400)
  })
})
