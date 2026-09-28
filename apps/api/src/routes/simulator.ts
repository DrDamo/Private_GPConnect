import type { FastifyInstance } from 'fastify'
import { AdapterError, DRAMA_MOBILE_RANGE, nhsLoginPersonas } from '@pgpc/adapters'
import { ageOn } from '@pgpc/core'
import { PATIENTS, practiceByOds } from '@pgpc/fixtures'

// Endpoints that only exist because this is a simulation: the synthetic patient
// list, the NHS login persona picker and the on-screen phone. None of these
// would exist in a real deployment.

const tags = ['simulator']

export async function simulatorRoutes(app: FastifyInstance) {
  app.get(
    '/api/sim/patients',
    { schema: { summary: 'Synthetic test patients and the scenario each one exercises', tags } },
    async () => {
      const now = new Date()
      return PATIENTS.map(p => {
        const practice = practiceByOds(p.gpOdsCode)
        return {
          nhsNumber: p.nhsNumber,
          name: [p.name.prefix, ...p.name.given, p.name.family].filter(Boolean).join(' '),
          birthDate: p.birthDate,
          age: ageOn(p.birthDate, now),
          gender: p.gender,
          restricted: p.confidentiality !== 'U',
          deceased: Boolean(p.deceasedDateTime),
          mobile: p.mobile ?? null,
          nhsLogin: p.nhsLogin?.identityProofingLevel ?? null,
          practice: practice
            ? { odsCode: practice.odsCode, name: practice.name, supplier: practice.supplier, gpConnectEnabled: practice.gpConnectEnabled }
            : null,
          scenario: p.scenario,
          tags: p.tags,
        }
      })
    },
  )

  app.get(
    '/api/sim/nhs-login/personas',
    { schema: { summary: 'NHS login accounts available in the persona picker', tags } },
    async () => nhsLoginPersonas(),
  )

  app.post<{ Body: { sub: string; state: string; nonce: string; redirectUri: string } }>(
    '/api/sim/nhs-login/authorize',
    {
      schema: {
        summary: 'Persona picker: "log in" as a persona and get the redirect back to the app',
        tags,
        body: {
          type: 'object',
          required: ['sub', 'state', 'nonce', 'redirectUri'],
          additionalProperties: false,
          properties: {
            sub: { type: 'string', maxLength: 100 },
            state: { type: 'string', minLength: 8, maxLength: 200 },
            nonce: { type: 'string', minLength: 8, maxLength: 200 },
            // Same-origin paths only: no open redirects, even in a simulator.
            redirectUri: { type: 'string', pattern: '^/(?!/)[A-Za-z0-9/_\\-.]*$', maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        return { location: app.services.simulator.nhsLogin.issueCode(req.body) }
      } catch (err) {
        if (err instanceof AdapterError && err.code === 'not-found') return reply.code(404).send({ error: 'unknown-persona' })
        throw err
      }
    },
  )

  app.get<{ Params: { mobile: string }; Querystring: { limit?: number } }>(
    '/api/sim/phone/:mobile/messages',
    {
      schema: {
        summary: 'Simulated phone: SMS messages sent to a drama-range number',
        tags,
        params: { type: 'object', properties: { mobile: { type: 'string', pattern: DRAMA_MOBILE_RANGE.source } } },
        querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } } },
      },
    },
    async req => app.services.simulator.outbox.list({ to: req.params.mobile, limit: req.query.limit ?? 20 }),
  )
}
