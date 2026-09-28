import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import sanitizeHtml from 'sanitize-html'
import { AdapterError, displayName, signToken, verifyToken, type PdsPatient } from '@pgpc/adapters'
import {
  ageOn,
  decide,
  effectiveStatus,
  HTML_SECTION_LABELS,
  HTML_SECTIONS,
  patientIneligibility,
  PROVIDER_PROFILES,
  PROVIDER_TYPE_LABELS,
  type ConsentRecord,
  type HtmlSection,
} from '@pgpc/core'
import { practiceByOds, PROVIDER_USERS, providerOrgByOds, providerUserById, type SimProviderOrg, type SimProviderUser } from '@pgpc/fixtures'
import { HttpError } from '../errors'
import { requestConsent } from '../flows/requestConsent'

// Provider portal and provider API (PLAN.md §4). Every read of patient data
// goes through the policy decision point and is audited, whether it is
// permitted, denied or fails.
//
// Sign-in is simulated: the real service would use NHS CIS2 (or OIDC with
// phishing-resistant MFA). The same signed token works as a cookie for the
// portal and as a Bearer token for provider systems calling the API.

const tags = ['provider']
const COOKIE = 'pgpc_provider'
const COOKIE_PATH = '/api/provider'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000

type ProviderSession = { userId: string; exp: number }
type Actor = { user: SimProviderUser; org: SimProviderOrg }

function authenticate(req: FastifyRequest, key: string): Actor {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined
  const token = bearer ?? req.cookies[COOKIE]
  const session = token ? verifyToken<ProviderSession>(token, key, new Date()) : null
  const user = session && providerUserById(session.userId)
  const org = user && providerOrgByOds(user.organisationOdsCode)
  if (!user || !org) throw new HttpError(401, 'sign-in-required', 'Please sign in')
  if (!user.active) throw new HttpError(403, 'account-disabled', 'This account has been disabled')
  return { user, org }
}

function requireClinician(actor: Actor) {
  if (actor.user.role !== 'clinician') {
    throw new HttpError(403, 'not-permitted', 'Only clinicians can work with patient records')
  }
}

const auditActor = (a: Actor) => ({
  type: 'user' as const,
  id: a.user.userId,
  organisationOdsCode: a.org.odsCode,
  role: a.user.role,
})

/** Only what a provider needs to confirm they have the right person. */
function patientCard(p: PdsPatient, now: Date) {
  const reasons = patientIneligibility(p, now)
  const practice = p.gp ? practiceByOds(p.gp.odsCode) : undefined
  if (p.restricted) {
    // Nothing beyond the NHS number for an S-flag record.
    return { nhsNumber: p.nhsNumber, restricted: true, eligible: false, ineligibleReasons: reasons }
  }
  return {
    nhsNumber: p.nhsNumber,
    restricted: false,
    name: displayName(p),
    birthDate: p.birthDate ?? null,
    age: p.birthDate ? ageOn(p.birthDate, now) : null,
    gender: p.gender,
    deceased: p.deceased,
    gp: p.gp ? { odsCode: p.gp.odsCode, name: practice?.name ?? p.gp.odsCode } : null,
    eligible: reasons.length === 0,
    ineligibleReasons: reasons,
  }
}

function consentSummary(c: ConsentRecord, now: Date, patientName?: string | null) {
  return {
    id: c.id,
    status: effectiveStatus(c, now),
    nhsNumber: c.patient.nhsNumber,
    patientName: patientName ?? null,
    purpose: c.episode.purpose,
    requestedBy: c.requestedBy.name,
    requestedAt: c.requestedAt,
    requestExpiresAt: c.requestExpiresAt,
    decision: c.decision ? { outcome: c.decision.outcome, at: c.decision.at, via: c.decision.evidence.channel } : null,
    scope: c.scope,
    htmlSections: c.scope.htmlSections.map(s => ({ code: s, label: HTML_SECTION_LABELS[s] })),
    validFrom: c.validFrom ?? null,
    expiresAt: c.expiresAt ?? null,
    withdrawal: c.withdrawal ?? null,
  }
}

const SANITISE: sanitizeHtml.IOptions = {
  allowedTags: ['div', 'h1', 'h2', 'h3', 'h4', 'p', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'b', 'i', 'strong', 'em', 'br', 'span'],
  allowedAttributes: { '*': ['class', 'id', 'colspan', 'rowspan'] },
  disallowedTagsMode: 'discard',
}

function noStore(_req: FastifyRequest, reply: FastifyReply, done: () => void) {
  reply.header('Cache-Control', 'no-store')
  done()
}

export async function providerRoutes(app: FastifyInstance) {
  const key = app.services.providerSessionKey
  const auth = (req: FastifyRequest) => authenticate(req, key)
  app.addHook('onRequest', noStore)

  // ---- Simulated sign-in -----------------------------------------------------

  app.get('/api/provider/sim/users', { schema: { summary: 'Simulator: provider staff you can sign in as', tags } }, async () =>
    PROVIDER_USERS.map(u => {
      const org = providerOrgByOds(u.organisationOdsCode)!
      return { ...u, organisation: { odsCode: org.odsCode, name: org.name, typeLabel: PROVIDER_TYPE_LABELS[org.type], active: org.active } }
    }),
  )

  app.post<{ Body: { userId: string } }>(
    '/api/provider/sim-login',
    {
      schema: {
        summary: 'Simulator: sign in as a provider user. Returns a token usable as a Bearer token',
        tags,
        body: { type: 'object', required: ['userId'], properties: { userId: { type: 'string', maxLength: 100 } } },
      },
    },
    async (req, reply) => {
      const user = providerUserById(req.body.userId)
      if (!user) throw new HttpError(404, 'not-found', 'Unknown user')
      const actor = { user, org: providerOrgByOds(user.organisationOdsCode)! }
      if (!user.active) {
        await app.services.audit.record({ type: 'provider.signed-in', outcome: 'denied', actor: auditActor(actor), correlationId: String(req.id), details: { reason: 'account-disabled' } })
        throw new HttpError(403, 'account-disabled', 'This account has been disabled')
      }
      const token = signToken({ userId: user.userId, exp: Date.now() + SESSION_TTL_MS }, key)
      reply.setCookie(COOKIE, token, {
        path: COOKIE_PATH,
        httpOnly: true,
        sameSite: 'strict',
        secure: req.protocol === 'https',
        maxAge: SESSION_TTL_MS / 1000,
      })
      await app.services.audit.record({ type: 'provider.signed-in', outcome: 'success', actor: auditActor(actor), correlationId: String(req.id) })
      return { token, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() }
    },
  )

  app.post('/api/provider/logout', { schema: { summary: 'Sign out', tags } }, async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: COOKIE_PATH })
    return { ok: true }
  })

  app.get('/api/provider/session', { schema: { summary: 'Who is signed in', tags } }, async req => {
    const { user, org } = auth(req)
    return {
      user: { userId: user.userId, name: user.name, role: user.role },
      organisation: { odsCode: org.odsCode, name: org.name, type: org.type, typeLabel: PROVIDER_TYPE_LABELS[org.type], active: org.active },
      profile: PROVIDER_PROFILES[org.type].scope,
    }
  })

  // ---- Patients ----------------------------------------------------------------

  async function withConsents(actor: Actor, card: ReturnType<typeof patientCard>) {
    const now = new Date()
    const consents = (await app.services.consentRepository.listByPatient(card.nhsNumber))
      .filter(c => c.provider.odsCode === actor.org.odsCode)
      .map(c => consentSummary(c, now))
    let gpConnect: 'available' | 'not-enabled' | 'unknown' = 'unknown'
    if ('gp' in card && card.gp) {
      gpConnect = (await app.services.adapters.sds.getGpConnectEndpoint(card.gp.odsCode)) ? 'available' : 'not-enabled'
    }
    return { patient: card, gpConnect, consents }
  }

  app.get<{ Params: { nhsNumber: string } }>(
    '/api/provider/patients/:nhsNumber',
    {
      schema: {
        summary: 'Find a patient by NHS number (PDS)',
        tags,
        params: { type: 'object', properties: { nhsNumber: { type: 'string', pattern: '^[0-9]{10}$' } } },
      },
    },
    async req => {
      const actor = auth(req)
      requireClinician(actor)
      try {
        const p = await app.services.adapters.pds.getPatient(req.params.nhsNumber)
        await app.services.audit.record({ type: 'pds.retrieve', outcome: 'success', actor: auditActor(actor), nhsNumber: p.nhsNumber, correlationId: String(req.id) })
        return withConsents(actor, patientCard(p, new Date()))
      } catch (err) {
        await app.services.audit.record({
          type: 'pds.retrieve',
          outcome: 'failure',
          actor: auditActor(actor),
          correlationId: String(req.id),
          details: { error: err instanceof AdapterError ? err.code : 'unexpected' },
        })
        throw err
      }
    },
  )

  app.get<{ Querystring: { family: string; given?: string; birthDate: string; gender?: PdsPatient['gender']; postalCode?: string } }>(
    '/api/provider/patients',
    {
      schema: {
        summary: 'Find a patient by demographics (PDS exact match, single result)',
        tags,
        querystring: {
          type: 'object',
          required: ['family', 'birthDate'],
          properties: {
            family: { type: 'string', minLength: 1, maxLength: 100 },
            given: { type: 'string', maxLength: 100 },
            birthDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            gender: { type: 'string', enum: ['female', 'male', 'other', 'unknown'] },
            postalCode: { type: 'string', maxLength: 10 },
          },
        },
      },
    },
    async req => {
      const actor = auth(req)
      requireClinician(actor)
      try {
        const p = await app.services.adapters.pds.search(req.query)
        await app.services.audit.record({
          type: 'pds.search',
          outcome: 'success',
          actor: auditActor(actor),
          ...(p ? { nhsNumber: p.nhsNumber } : {}),
          correlationId: String(req.id),
          details: { matched: Boolean(p) },
        })
        if (!p) throw new HttpError(404, 'no-match', 'No patient matches those details exactly')
        return withConsents(actor, patientCard(p, new Date()))
      } catch (err) {
        if (err instanceof AdapterError) {
          await app.services.audit.record({ type: 'pds.search', outcome: 'failure', actor: auditActor(actor), correlationId: String(req.id), details: { error: err.code } })
          if (err.code === 'too-many-matches') {
            throw new HttpError(422, 'too-many-matches', 'More than one patient matches. Add the postcode or search by NHS number.')
          }
        }
        throw err
      }
    },
  )

  // ---- Consents ----------------------------------------------------------------

  app.post<{ Body: { nhsNumber: string; purpose: string; durationDays?: number } }>(
    '/api/provider/consent-requests',
    {
      schema: {
        summary: "Ask a patient for consent (texts the patient at their PDS mobile)",
        tags,
        body: {
          type: 'object',
          required: ['nhsNumber', 'purpose'],
          additionalProperties: false,
          properties: {
            nhsNumber: { type: 'string', pattern: '^[0-9]{10}$' },
            purpose: { type: 'string', minLength: 5, maxLength: 200 },
            durationDays: { type: 'integer', minimum: 1, maximum: 180 },
          },
        },
      },
    },
    async (req, reply) => {
      const actor = auth(req)
      const result = await requestConsent(app.services, {
        user: actor.user,
        organisation: actor.org,
        nhsNumber: req.body.nhsNumber,
        purpose: req.body.purpose,
        durationDays: req.body.durationDays,
        episodeId: `ep-${crypto.randomUUID().slice(0, 8)}`,
        origin: `${req.protocol}://${req.host}`,
        correlationId: String(req.id),
      })
      return reply.code(201).send({
        consent: consentSummary(result.consent, new Date(), result.patientName),
        notification: result.notification,
      })
    },
  )

  app.get<{ Querystring: { status?: string } }>(
    '/api/provider/consents',
    { schema: { summary: "This organisation's consent requests and consents", tags } },
    async req => {
      const actor = auth(req)
      requireClinician(actor)
      const now = new Date()
      const records = await app.services.consentRepository.listByProvider(actor.org.odsCode)
      const names = new Map<string, string | null>()
      await Promise.all(
        [...new Set(records.map(r => r.patient.nhsNumber))].map(async n => {
          try {
            const p = await app.services.adapters.pds.getPatient(n)
            names.set(n, p.restricted ? null : displayName(p))
          } catch {
            names.set(n, null)
          }
        }),
      )
      return records
        .map(r => consentSummary(r, now, names.get(r.patient.nhsNumber)))
        .filter(c => !req.query.status || c.status === req.query.status)
    },
  )

  async function ownConsent(actor: Actor, id: string): Promise<ConsentRecord> {
    const c = /^[0-9a-f-]{36}$/i.test(id) ? await app.services.consentRepository.get(id) : null
    if (!c || c.provider.odsCode !== actor.org.odsCode) throw new HttpError(404, 'not-found', 'Consent not found')
    return c
  }

  app.get<{ Params: { id: string } }>('/api/provider/consents/:id', { schema: { summary: 'One consent', tags } }, async req => {
    const actor = auth(req)
    requireClinician(actor)
    const c = await ownConsent(actor, req.params.id)
    let name: string | null = null
    try {
      const p = await app.services.adapters.pds.getPatient(c.patient.nhsNumber)
      name = p.restricted ? null : displayName(p)
    } catch {
      // The name is for display only.
    }
    return consentSummary(c, new Date(), name)
  })

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/provider/consents/:id/cancel',
    {
      schema: {
        summary: 'Cancel a pending request, or end access early (e.g. episode complete)',
        tags,
        body: { type: 'object', properties: { reason: { type: 'string', maxLength: 500 } } },
      },
    },
    async req => {
      const actor = auth(req)
      requireClinician(actor)
      const c = await ownConsent(actor, req.params.id)
      const updated = await app.services.consents.withdraw(c.id, { kind: 'provider', actor: auditActor(actor) }, req.body?.reason, {
        correlationId: String(req.id),
      })
      return consentSummary(updated, new Date())
    },
  )

  // ---- GP record: HTML view ------------------------------------------------------

  app.get<{ Params: { id: string; section: string } }>(
    '/api/provider/consents/:id/html/:section',
    {
      schema: {
        summary: 'View a section of the GP record (GP Connect Access Record: HTML). Checked and audited',
        tags,
        params: {
          type: 'object',
          properties: { id: { type: 'string' }, section: { type: 'string', enum: [...HTML_SECTIONS] } },
        },
      },
    },
    async req => {
      const actor = auth(req)
      const { audit, adapters } = app.services
      const section = req.params.section as HtmlSection
      const consent = await ownConsent(actor, req.params.id)
      const nhsNumber = consent.patient.nhsNumber
      const base = { type: 'access.html.view', actor: auditActor(actor), nhsNumber, consentId: consent.id, correlationId: String(req.id) }

      const patient = await adapters.pds.getPatient(nhsNumber)
      const decision = decide({
        action: 'html.view',
        actor: { userId: actor.user.userId, role: actor.user.role, active: actor.user.active, organisationOdsCode: actor.user.organisationOdsCode },
        organisation: { odsCode: actor.org.odsCode, type: actor.org.type, active: actor.org.active },
        patient: { nhsNumber, restricted: patient.restricted, deceased: patient.deceased, birthDate: patient.birthDate },
        consent,
        htmlSection: section,
        now: new Date(),
      })
      if (decision.decision === 'deny') {
        await audit.record({ ...base, outcome: 'denied', details: { section, reasons: decision.reasons } })
        throw new HttpError(403, 'access-denied', 'Access to this record is not permitted', { reasons: decision.reasons })
      }

      const endpoint = patient.gp ? await adapters.sds.getGpConnectEndpoint(patient.gp.odsCode) : null
      if (!endpoint) {
        await audit.record({ ...base, outcome: 'failure', details: { section, error: 'gp-connect-not-enabled' } })
        throw new HttpError(422, 'gp-connect-not-enabled', "The patient's GP practice does not offer GP Connect, so the record cannot be retrieved")
      }

      try {
        const { record, exchange } = await adapters.gpConnectHtml.getCareRecord({
          nhsNumber,
          section,
          endpoint,
          requester: { user: actor.user, organisation: { odsCode: actor.org.odsCode, name: actor.org.name } },
          traceId: String(req.id),
        })
        await audit.record({ ...base, outcome: 'success', details: { section, practice: endpoint.odsCode, supplier: endpoint.supplier } })
        return {
          section,
          title: record.title,
          html: sanitizeHtml(record.html, SANITISE),
          generatedAt: record.generatedAt ?? null,
          practice: { odsCode: endpoint.odsCode, name: record.practice?.name ?? endpoint.odsCode, supplier: endpoint.supplier },
          placeholder: true,
          viewedBy: actor.user.name,
          viewedAt: new Date().toISOString(),
          // Simulation only: what was sent to the GP system, for inspection.
          exchange: {
            url: exchange.url,
            headers: { ...exchange.headers, Authorization: `Bearer ${exchange.headers.Authorization.slice(7, 40)}…` },
            jwtClaims: exchange.jwtClaims,
            body: exchange.body,
          },
        }
      } catch (err) {
        await audit.record({
          ...base,
          outcome: 'failure',
          details: { section, error: err instanceof AdapterError ? `${err.adapter}-${err.code}` : 'unexpected' },
        })
        throw err
      }
    },
  )
}
