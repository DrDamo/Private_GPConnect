import { beforeEach, describe, expect, it } from 'vitest'
import type { SqlClient } from '@pgpc/store-postgres'
import type { FastifyInstance } from 'fastify'
import { freshDatabase } from '../../../packages/store-postgres/test/pglite'
import { buildApp } from '../src/app'
import { postgresServices } from '../src/services'
import { Browser, patientGrants, signInWithNhsLogin } from './helpers'

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

/** Makes audit appends fail on demand, as a lost connection or full disk would. */
function failingAudit(sql: SqlClient, state: { fail: boolean }): SqlClient {
  return {
    query(text, params) {
      if (state.fail && text.includes('insert into pgpc.audit_events')) return Promise.reject(new Error('audit write failed'))
      return sql.query(text, params)
    },
    transaction: fn => sql.transaction(tx => fn(failingAudit(tx, state))),
  }
}

describe('a consent change and its audit event are atomic', () => {
  it('does not keep a consent request, or a grant, whose audit event failed', async () => {
    const { db, sql } = await freshDatabase()
    const state = { fail: false }
    const app = await buildApp({ services: postgresServices(failingAudit(sql, state), 'k'.repeat(32)) })
    const count = async (where = 'true') =>
      (await db.query<{ n: number }>(`select count(*)::int as n from pgpc.consents where ${where}`)).rows[0].n
    try {
      const provider = new Browser(app)
      await provider.post('/api/provider/sim-login', { userId: 'sim-user-ph-pharm' })

      state.fail = true
      const refused = await provider.post('/api/provider/consent-requests', { nhsNumber: '9990000018', purpose: 'Supply of medicine' })
      expect(refused.statusCode).toBe(500)
      expect(await count()).toBe(0)

      state.fail = false
      const req = await provider.post('/api/provider/consent-requests', { nhsNumber: '9990000018', purpose: 'Supply of medicine' })
      expect(req.statusCode).toBe(201)
      const consentId = req.json().consent.id as string

      const patient = new Browser(app)
      await signInWithNhsLogin(patient, 'sim-nhslogin-0001')
      const view = (await patient.get(`/api/patient/consents/${consentId}`)).json()
      state.fail = true
      const grant = await patient.post(`/api/patient/consents/${consentId}/decision`, {
        decision: 'grant',
        consentTextVersion: view.consentTextVersion,
        consentTextHash: view.consentTextHash,
      })
      expect(grant.statusCode).toBe(500)
      expect(await count("status = 'active'")).toBe(0)
      expect(await count("status = 'pending'")).toBe(1)
    } finally {
      await app.close()
    }
  })
})
