import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp, SIMULATION_HEADER } from '../src/app'
import { createServices } from '../src/services'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp({ services: createServices({}) })
})

afterAll(async () => {
  await app.close()
})

describe('GET /api/health', () => {
  it('reports ok in simulation mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok', mode: 'simulation', store: 'memory', database: 'ok' })
  })

  it('reports degraded when the database is unreachable', async () => {
    const services = createServices({})
    const degraded = await buildApp({ services: { ...services, ping: async () => false } })
    const res = await degraded.inject({ method: 'GET', url: '/api/health' })
    expect(res.json()).toMatchObject({ status: 'degraded', database: 'unavailable' })
    await degraded.close()
  })

  it('marks every response as simulated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.headers[SIMULATION_HEADER]).toBe('true')
  })
})

describe('GET /api/openapi.json', () => {
  it('publishes an OpenAPI document that lists the health route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json' })
    expect(res.statusCode).toBe(200)
    const doc = res.json()
    expect(doc.openapi).toMatch(/^3\./)
    expect(doc.paths).toHaveProperty('/api/health')
    expect(doc.paths).not.toHaveProperty('/api/openapi.json')
  })
})

describe('unknown routes', () => {
  it('return 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
  })
})
