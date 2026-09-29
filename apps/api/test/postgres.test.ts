import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { freshDatabase } from '../../../packages/store-postgres/test/pglite'
import { buildApp } from '../src/app'
import { postgresServices } from '../src/services'
import { Browser, patientGrants } from './helpers'

// The hosted demo runs on Postgres; the other API tests use in-memory stores.
// This runs the main journeys through the real Postgres stores (on PGlite), so a
// route that only breaks on Postgres fails here rather than in the demo.

let app: FastifyInstance

beforeEach(async () => {
  const { sql } = await freshDatabase()
  app = await buildApp({ services: postgresServices(sql, 'k'.repeat(32)) })
  return () => app.close()
})

describe('API on Postgres', () => {
  it('runs the provider journey end to end', async () => {
    const provider = new Browser(app)
    expect((await provider.post('/api/provider/sim-login', { userId: 'sim-user-ph-pharm' })).statusCode).toBe(200)
    const found = await provider.get('/api/provider/patients/9990000018')
    expect(found.statusCode, found.body).toBe(200)
    const req = await provider.post('/api/provider/consent-requests', { nhsNumber: '9990000018', purpose: 'Supply of medicine' })
    expect(req.statusCode, req.body).toBe(201)
    const consentId = req.json().consent.id as string
    await patientGrants(app, consentId, 'sim-nhslogin-0001')
    const list = await provider.get('/api/provider/consents')
    expect(list.statusCode, list.body).toBe(200)
    const view = await provider.get(`/api/provider/consents/${consentId}/html/SUM`)
    expect(view.statusCode, view.body).toBe(200)
    const structured = await provider.get(`/api/provider/consents/${consentId}/structured`)
    expect(structured.statusCode, structured.body).toBe(200)

    const admin = new Browser(app)
    await admin.post('/api/admin/sim-login', { userId: 'sim-admin-operator' })
    expect((await admin.get('/api/admin/overview')).json()).toMatchObject({ store: 'postgres', consents: { active: 1 } })
    expect((await admin.put('/api/admin/faults/pds', { kind: 'unavailable' })).statusCode).toBe(200)
    await admin.put('/api/admin/faults/pds', { kind: 'none' })
    const audit = (await admin.get('/api/admin/audit?nhsNumber=9990000018')).json() as Array<{ type: string }>
    expect(audit.map(e => e.type)).toContain('access.html.view')
    expect((await admin.get('/api/admin/audit/verify')).json()).toMatchObject({ valid: true })
  })
})
