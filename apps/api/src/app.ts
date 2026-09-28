import Fastify, { type FastifyInstance } from 'fastify'
import swagger from '@fastify/swagger'
import { createServices, type Services } from './services'

// Everything the service does is simulated until real adapters exist. Every
// response carries this header so no consumer can mistake mock output for a
// real patient record.
export const SIMULATION_HEADER = 'x-simulation'

export interface AppOptions {
  logger?: boolean
  /** Defaults to services chosen from the environment (see createServices). */
  services?: Services
}

declare module 'fastify' {
  interface FastifyInstance {
    services: Services
  }
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false })
  const services = options.services ?? createServices()
  app.decorate('services', services)
  app.addHook('onClose', () => services.close())

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Private GP Connect middleware (SIMULATION)',
        description:
          'Provider-facing API for the simulated middleware. All national services ' +
          '(PDS, SDS, GP Connect, MESH, NHS login) are mocked and all data is synthetic.',
        version: '0.1.0',
      },
      servers: [{ url: '/' }],
    },
  })

  app.addHook('onSend', async (_request, reply) => {
    reply.header(SIMULATION_HEADER, 'true')
  })

  app.get(
    '/api/health',
    {
      schema: {
        summary: 'Service health',
        tags: ['meta'],
        response: {
          200: {
            type: 'object',
            required: ['status', 'mode', 'version', 'store', 'database'],
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded'] },
              mode: { type: 'string', enum: ['simulation'] },
              version: { type: 'string' },
              commit: { type: 'string', nullable: true },
              store: { type: 'string', enum: ['memory', 'postgres'] },
              database: { type: 'string', enum: ['ok', 'unavailable'] },
            },
          },
        },
      },
    },
    async () => {
      const dbOk = await services.ping()
      return {
        status: dbOk ? ('ok' as const) : ('degraded' as const),
        mode: 'simulation' as const,
        version: '0.1.0',
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
        store: services.storeKind,
        database: dbOk ? ('ok' as const) : ('unavailable' as const),
      }
    },
  )

  app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger())

  return app
}
