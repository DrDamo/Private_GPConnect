import type { FastifyInstance } from 'fastify'
import { AdapterError, DRAMA_MOBILE_RANGE, nhsLoginPersonas, readSendDocumentBundle, type MeshMessage } from '@pgpc/adapters'
import { ageOn, PROVIDER_PROFILES, PROVIDER_TYPE_LABELS } from '@pgpc/core'
import { meshMailboxFor, PATIENTS, practiceByOds, PRACTICES, PROVIDER_ORGS, PROVIDER_USERS, providerOrgByOds, providerUserById } from '@pgpc/fixtures'
import { HttpError } from '../errors'
import { requestConsent } from '../flows/requestConsent'
import { sanitiseGpHtml } from '../sanitise'

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

/** Demo launcher (until the provider portal exists): act as a simulated provider user. */
export async function simulatorDemoRoutes(app: FastifyInstance) {
  app.get(
    '/api/sim/providers',
    { schema: { summary: 'Simulated provider organisations and their users', tags } },
    async () =>
      PROVIDER_ORGS.map(o => ({
        ...o,
        typeLabel: PROVIDER_TYPE_LABELS[o.type],
        profile: PROVIDER_PROFILES[o.type].scope,
        users: PROVIDER_USERS.filter(u => u.organisationOdsCode === o.odsCode),
      })),
  )

  app.post<{ Body: { userId: string; nhsNumber: string; purpose?: string } }>(
    '/api/sim/consent-requests',
    {
      schema: {
        summary: 'Demo: create a consent request as a simulated provider user (texts the patient)',
        tags,
        body: {
          type: 'object',
          required: ['userId', 'nhsNumber'],
          additionalProperties: false,
          properties: {
            userId: { type: 'string', maxLength: 100 },
            nhsNumber: { type: 'string', pattern: '^[0-9 ]{10,12}$' },
            purpose: { type: 'string', minLength: 3, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = providerUserById(req.body.userId)
      const org = user && providerOrgByOds(user.organisationOdsCode)
      if (!user || !org) throw new HttpError(404, 'not-found', 'Unknown simulated user')
      const defaults: Record<string, string> = {
        pharmacy: 'Checking it is safe to supply a prescription-only medicine',
        'weight-management': 'Assessment for weight-loss medication',
        'medical-cannabis': 'Assessment for a cannabis-based medicine',
      }
      const result = await requestConsent(app.services, {
        user,
        organisation: org,
        nhsNumber: req.body.nhsNumber.replace(/\s/g, ''),
        purpose: req.body.purpose ?? defaults[org.type],
        episodeId: `sim-episode-${crypto.randomUUID().slice(0, 8)}`,
        origin: `${req.protocol}://${req.host}`,
        correlationId: String(req.id),
      })
      return reply.code(201).send({
        consentId: result.consent.id,
        patientName: result.patientName,
        provider: org.name,
        status: result.consent.status,
        requestExpiresAt: result.consent.requestExpiresAt,
        patientLink: `/patient/consent/${result.consent.id}`,
        notification: result.notification,
      })
    },
  )
}

/** Simulated GP practices receiving Send Document over MESH: what the practice sees. */
export async function simulatorPracticeRoutes(app: FastifyInstance) {
  const store = () => app.services.simulator.mesh

  const summary = (m: MeshMessage) => {
    const doc = readSendDocumentBundle(m.content as never)
    return {
      id: m.id,
      sentAt: m.sentAt,
      subject: m.subject,
      from: m.from,
      senderOds: doc.senderOds ?? null,
      senderName: (doc.senderOds && providerOrgByOds(doc.senderOds)?.name) || doc.senderOds || m.from,
      nhsNumber: doc.nhsNumber ?? null,
      status: m.status,
      statusAt: m.statusAt,
      statusNote: m.statusNote ?? null,
    }
  }

  async function ownMessage(ods: string, id: string) {
    const practice = practiceByOds(ods)
    const m = practice && /^[0-9a-f-]{36}$/i.test(id) ? await store().get(id) : null
    if (!practice || !m || m.to !== meshMailboxFor(practice.odsCode)) throw new HttpError(404, 'not-found', 'Message not found')
    return m
  }

  app.get('/api/sim/practices', { schema: { summary: 'Simulated GP practices and their MESH mailboxes', tags } }, async () =>
    PRACTICES.map(p => ({ odsCode: p.odsCode, name: p.name, supplier: p.supplier, mailbox: meshMailboxFor(p.odsCode), acceptsSendDocument: p.acceptsSendDocument })),
  )

  app.get<{ Params: { ods: string } }>(
    '/api/sim/practices/:ods/inbox',
    { schema: { summary: "A practice's inbox of documents received over MESH", tags } },
    async req => {
      const practice = practiceByOds(req.params.ods.toUpperCase())
      if (!practice) throw new HttpError(404, 'not-found', 'Unknown practice')
      return (await store().listForMailbox(meshMailboxFor(practice.odsCode), 50)).map(summary)
    },
  )

  app.get<{ Params: { ods: string; id: string } }>(
    '/api/sim/practices/:ods/inbox/:id',
    { schema: { summary: 'Open a received document (marks it downloaded)', tags } },
    async req => {
      let m = await ownMessage(req.params.ods.toUpperCase(), req.params.id)
      if (m.status === 'accepted') {
        await store().setStatus(m.id, 'downloaded', new Date().toISOString())
        m = (await store().get(m.id))!
      }
      const doc = readSendDocumentBundle(m.content as never)
      return { ...summary(m), title: doc.title, html: sanitiseGpHtml(doc.html), bundle: m.content }
    },
  )

  app.post<{ Params: { ods: string; id: string }; Body: { action: 'file' | 'reject'; reason?: string } }>(
    '/api/sim/practices/:ods/inbox/:id/acknowledge',
    {
      schema: {
        summary: 'Practice files the document in the patient record, or rejects it (business acknowledgement)',
        tags,
        body: {
          type: 'object',
          required: ['action'],
          properties: { action: { type: 'string', enum: ['file', 'reject'] }, reason: { type: 'string', maxLength: 300 } },
        },
      },
    },
    async req => {
      const m = await ownMessage(req.params.ods.toUpperCase(), req.params.id)
      const [status, note] =
        req.body.action === 'file'
          ? (['acknowledged', 'Filed in patient record'] as const)
          : (['rejected', `Rejected by practice${req.body.reason ? `: ${req.body.reason}` : ''}`] as const)
      await store().setStatus(m.id, status, new Date().toISOString(), note)
      return summary((await store().get(m.id))!)
    },
  )
}
