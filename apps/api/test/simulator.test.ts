import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { createServices } from '../src/services'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp({ services: createServices({}) })
})
afterAll(() => app.close())

describe('GET /api/sim/patients', () => {
  it('lists every synthetic patient with its scenario and practice', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sim/patients' })
    expect(res.statusCode).toBe(200)
    const patients = res.json() as Array<Record<string, unknown>>
    expect(patients.length).toBeGreaterThanOrEqual(15)
    expect(patients.find(p => p.nhsNumber === '9990000069')).toMatchObject({ restricted: true, tags: ['restricted', 'must-deny'] })
    expect(patients.find(p => p.nhsNumber === '9990000107')).toMatchObject({ practice: { gpConnectEnabled: false } })
  })
})

describe('simulated NHS login', () => {
  const authorize = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/sim/nhs-login/authorize', payload: body })
  const valid = { sub: 'sim-nhslogin-0001', state: 'state-12345', nonce: 'nonce-12345', redirectUri: '/patient/callback' }

  it('issues a code the NHS login adapter accepts', async () => {
    const res = await authorize(valid)
    expect(res.statusCode).toBe(200)
    const url = new URL(res.json().location, 'http://x')
    expect(url.pathname).toBe('/patient/callback')
    const identity = await app.services.adapters.nhsLogin.exchangeCode({
      code: url.searchParams.get('code')!,
      redirectUri: '/patient/callback',
      nonce: 'nonce-12345',
    })
    expect(identity.nhsNumber).toBe('9990000018')
  })

  it.each(['https://evil.example/cb', '//evil.example/cb', 'javascript:alert(1)'])('refuses redirect to %s', async redirectUri => {
    expect((await authorize({ ...valid, redirectUri })).statusCode).toBe(400)
  })

  it('404s an unknown persona', async () => {
    expect((await authorize({ ...valid, sub: 'nobody' })).statusCode).toBe(404)
  })

  it('lists personas', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sim/nhs-login/personas' })
    expect(res.json()).toContainEqual(expect.objectContaining({ sub: 'sim-nhslogin-0013', identityProofingLevel: 'P5' }))
  })
})

describe('simulated phone', () => {
  it('shows messages sent through the SMS adapter', async () => {
    await app.services.adapters.sms.send({ to: '07700900003', body: 'Your code is 123456' })
    const res = await app.inject({ method: 'GET', url: '/api/sim/phone/07700900003/messages' })
    expect(res.json()).toEqual([expect.objectContaining({ to: '07700900003', body: 'Your code is 123456' })])
  })

  it('rejects a number outside the drama range', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/sim/phone/07911123456/messages' })).statusCode).toBe(400)
  })
})
