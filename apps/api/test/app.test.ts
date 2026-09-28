import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp, SIMULATION_HEADER } from '../src/app'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
})

describe('GET /api/health', () => {
  it('reports ok in simulation mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok', mode: 'simulation' })
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
