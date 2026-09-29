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

const glp1 = {
  kind: 'supply-notification',
  summary: 'Assessed for weight management. BMI 36.4 with type 2 diabetes. Started a GLP-1 receptor agonist.',
  medicines: [{ name: 'Semaglutide 0.25mg/0.19ml pen', dosageInstruction: 'Inject 0.25mg once weekly', quantity: '1 pen', date: '2026-10-01' }],
  adviceForGp: 'Past eating disorder noted from the GP record; we will review monthly.',
}

async function consented(nhsNumber: string, sub: string, userId = 'sim-user-wm-doc') {
  const provider = new Browser(app)
  await provider.post('/api/provider/sim-login', { userId })
  const consentId = (await provider.post('/api/provider/consent-requests', { nhsNumber, purpose: 'Assessment for weight-loss medication' })).json().consent.id as string
  const patient = await patientGrants(app, consentId, sub)
  return { provider, patient, consentId }
}

describe('Send Document', () => {
  it('provider notifies the GP; the practice receives, reads and files it; everyone sees the right status', async () => {
    const { provider, patient, consentId } = await consented('9990000034', 'sim-nhslogin-0003')

    const sent = await provider.post(`/api/provider/consents/${consentId}/documents`, glp1)
    expect(sent.statusCode).toBe(201)
    const { messageId } = sent.json()
    expect(sent.json()).toMatchObject({ status: 'accepted', title: 'Notification of medicine supplied or prescribed', practice: { odsCode: 'SIMGP1' } })

    // Practice inbox
    const inbox = (await app.inject({ method: 'GET', url: '/api/sim/practices/SIMGP1/inbox' })).json()
    expect(inbox).toEqual([expect.objectContaining({ id: messageId, nhsNumber: '9990000034', senderName: 'Balance Weight Clinic (simulated)', status: 'accepted' })])
    const opened = (await app.inject({ method: 'GET', url: `/api/sim/practices/SIMGP1/inbox/${messageId}` })).json()
    expect(opened.status).toBe('downloaded')
    expect(opened.html).toContain('Inject 0.25mg once weekly')
    expect(opened.bundle.type).toBe('message')
    // Another practice can't read it.
    expect((await app.inject({ method: 'GET', url: `/api/sim/practices/SIMGP2/inbox/${messageId}` })).statusCode).toBe(404)
    await app.inject({ method: 'POST', url: `/api/sim/practices/SIMGP1/inbox/${messageId}/acknowledge`, payload: { action: 'file' } })

    // Provider sees delivery status
    const docs = (await provider.get(`/api/provider/consents/${consentId}/documents`)).json()
    expect(docs).toEqual([expect.objectContaining({ messageId, status: 'acknowledged', statusNote: 'Filed in patient record', sentBy: 'Dr Helen Carter' })])

    // Patient sees it in their log
    const log = ((await patient.get('/api/patient/me/access-log')).json() as Array<{ description: string }>).map(e => e.description)
    expect(log).toContain('Balance Weight Clinic (simulated) sent your GP practice "Notification of medicine supplied or prescribed"')

    // The middleware kept no copy: only the audit entry with the message id.
    const event = (await app.services.audit.forConsent(consentId)).find(e => e.type === 'access.document.send')
    expect(event?.details).toMatchObject({ messageId, workflowId: 'GPFED_CONSULT_REPORT', medicines: 1 })
    expect(JSON.stringify(event)).not.toContain('Semaglutide')
  })

  it('is allowed under a text-message (view-only) consent: telling the GP is the safe direction', async () => {
    const provider = new Browser(app)
    await provider.post('/api/provider/sim-login', { userId: 'sim-user-ph-pharm' })
    const consentId = (await provider.post('/api/provider/consent-requests', { nhsNumber: '9990000050', purpose: 'Checking interactions' })).json().consent.id
    const pat = new Browser(app)
    const start = await pat.post('/api/patient/sms/start', { consentId })
    const code = /code is (\d{6})/.exec(await latestSms(app, '07700900005'))![1]
    await pat.post('/api/patient/sms/verify', { challengeId: start.json().challengeId, code, birthDate: '1950-05-09' })
    const view = (await pat.get(`/api/patient/consents/${consentId}`)).json()
    await pat.post(`/api/patient/consents/${consentId}/decision`, { decision: 'grant', consentTextVersion: view.consentTextVersion, consentTextHash: view.consentTextHash })

    const res = await provider.post(`/api/provider/consents/${consentId}/documents`, {
      kind: 'care-summary',
      summary: 'Advised on interaction between warfarin and an over-the-counter product. No supply made.',
    })
    expect(res.statusCode).toBe(201)
  })

  it('refused after the patient withdraws consent', async () => {
    const { provider, patient, consentId } = await consented('9990000034', 'sim-nhslogin-0003')
    await patient.post(`/api/patient/consents/${consentId}/withdraw`, {})
    const res = await provider.post(`/api/provider/consents/${consentId}/documents`, glp1)
    expect(res.statusCode).toBe(403)
    expect(res.json().reasons).toEqual(['consent-not-active'])
  })

  it("explains when the practice can't receive documents this way", async () => {
    const { provider, consentId } = await consented('9990000107', 'sim-nhslogin-0010')
    const res = await provider.post(`/api/provider/consents/${consentId}/documents`, glp1)
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('send-document-not-supported')
  })

  it('a supply notification must list a medicine', async () => {
    const { provider, consentId } = await consented('9990000034', 'sim-nhslogin-0003')
    const res = await provider.post(`/api/provider/consents/${consentId}/documents`, { ...glp1, medicines: [] })
    expect(res.statusCode).toBe(400)
  })

  it('a rejection by the practice is visible to the provider', async () => {
    const { provider, consentId } = await consented('9990000034', 'sim-nhslogin-0003')
    const { messageId } = (await provider.post(`/api/provider/consents/${consentId}/documents`, glp1)).json()
    await app.inject({ method: 'POST', url: `/api/sim/practices/SIMGP1/inbox/${messageId}/acknowledge`, payload: { action: 'reject', reason: 'Not our patient' } })
    const [doc] = (await provider.get(`/api/provider/consents/${consentId}/documents`)).json()
    expect(doc).toMatchObject({ status: 'rejected', statusNote: 'Rejected by practice: Not our patient' })
  })
})
