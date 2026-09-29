import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  AdapterError,
  buildSendDocumentBundle,
  displayName,
  SEND_DOCUMENT_WORKFLOW_ID,
  signToken,
  verifyToken,
  type DocumentKind,
  type PdsPatient,
  type SuppliedMedicine,
} from '@pgpc/adapters'
import { extractAllergies, extractCodedData, extractConsultations, extractLists, extractMedications, extractProblems } from '@pgpc/gpc-fhir'
import {
  ageOn,
  CLINICAL_AREA_LABELS,
  CLINICAL_AREAS,
  decide,
  effectiveStatus,
  HTML_SECTION_LABELS,
  HTML_SECTIONS,
  patientIneligibility,
  PROVIDER_PROFILES,
  PROVIDER_TYPE_LABELS,
  type ClinicalArea,
  type ConsentRecord,
  type HtmlSection,
} from '@pgpc/core'
import { MIDDLEWARE, practiceByOds, PROVIDER_USERS, providerOrgByOds, providerUserById, type SimProviderOrg, type SimProviderUser } from '@pgpc/fixtures'
import { HttpError } from '../errors'
import { requestConsent } from '../flows/requestConsent'
import { sanitiseGpHtml } from '../sanitise'

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
    clinicalAreas: c.scope.clinicalAreas.map(a => ({ code: a, label: CLINICAL_AREA_LABELS[a] })),
    validFrom: c.validFrom ?? null,
    expiresAt: c.expiresAt ?? null,
    withdrawal: c.withdrawal ?? null,
  }
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
          html: sanitiseGpHtml(record.html),
          generatedAt: record.generatedAt ?? null,
          practice: { odsCode: endpoint.odsCode, name: record.practice?.name ?? endpoint.odsCode, supplier: endpoint.supplier },
          // Access Record HTML 0.7.x is FHIR DSTU2 (Structured is STU3).
          fhirVersion: 'DSTU2',
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
          details: {
            section,
            error: err instanceof AdapterError ? `${err.adapter}-${err.code}` : 'unexpected',
            ...(err instanceof AdapterError && err.details?.gpConnectCode ? { gpConnectCode: err.details.gpConnectCode } : {}),
          },
        })
        throw err
      }
    },
  )

  // ---- GP record: structured data ------------------------------------------------

  app.get<{ Params: { id: string }; Querystring: { areas?: string; format?: 'summary' | 'bundle' } }>(
    '/api/provider/consents/:id/structured',
    {
      schema: {
        summary: 'Retrieve structured data (GP Connect Access Record: Structured, FHIR STU3). Checked and audited',
        description:
          'Returns only the consented clinical areas (optionally narrowed with `areas`). ' +
          '`format=bundle` returns the FHIR STU3 Bundle alone, for provider systems to import.',
        tags,
        querystring: {
          type: 'object',
          properties: {
            areas: { type: 'string', pattern: `^(${CLINICAL_AREAS.join('|')})(,(${CLINICAL_AREAS.join('|')}))*$` },
            format: { type: 'string', enum: ['summary', 'bundle'], default: 'summary' },
          },
        },
      },
    },
    async (req, reply) => {
      const actor = auth(req)
      const { audit, adapters } = app.services
      const consent = await ownConsent(actor, req.params.id)
      const nhsNumber = consent.patient.nhsNumber
      const areas = (req.query.areas ? [...new Set(req.query.areas.split(','))] : consent.scope.clinicalAreas) as ClinicalArea[]
      const base = { type: 'access.structured.retrieve', actor: auditActor(actor), nhsNumber, consentId: consent.id, correlationId: String(req.id) }

      const patient = await adapters.pds.getPatient(nhsNumber)
      const decision = decide({
        action: 'structured.retrieve',
        actor: { userId: actor.user.userId, role: actor.user.role, active: actor.user.active, organisationOdsCode: actor.user.organisationOdsCode },
        organisation: { odsCode: actor.org.odsCode, type: actor.org.type, active: actor.org.active },
        patient: { nhsNumber, restricted: patient.restricted, deceased: patient.deceased, birthDate: patient.birthDate },
        consent,
        clinicalAreas: areas,
        now: new Date(),
      })
      if (decision.decision === 'deny') {
        await audit.record({ ...base, outcome: 'denied', details: { areas, reasons: decision.reasons } })
        throw new HttpError(403, 'access-denied', 'Access to this record is not permitted', { reasons: decision.reasons })
      }
      const endpoint = patient.gp ? await adapters.sds.getGpConnectEndpoint(patient.gp.odsCode) : null
      if (!endpoint) {
        await audit.record({ ...base, outcome: 'failure', details: { areas, error: 'gp-connect-not-enabled' } })
        throw new HttpError(422, 'gp-connect-not-enabled', "The patient's GP practice does not offer GP Connect, so the record cannot be retrieved")
      }

      let result
      try {
        result = await adapters.gpConnectStructured.getStructuredRecord({
          nhsNumber,
          areas,
          endpoint,
          requester: { user: actor.user, organisation: { odsCode: actor.org.odsCode, name: actor.org.name } },
          traceId: String(req.id),
        })
      } catch (err) {
        await audit.record({
          ...base,
          outcome: 'failure',
          details: {
            areas,
            error: err instanceof AdapterError ? `${err.adapter}-${err.code}` : 'unexpected',
            ...(err instanceof AdapterError && err.details?.gpConnectCode ? { gpConnectCode: err.details.gpConnectCode } : {}),
          },
        })
        throw err
      }
      const { record, exchange } = result
      await audit.record({
        ...base,
        outcome: 'success',
        details: { areas, practice: endpoint.odsCode, supplier: endpoint.supplier, strippedUnrequested: record.removed.length },
      })

      if (req.query.format === 'bundle') {
        return reply.header('Content-Type', 'application/fhir+json; fhirVersion=3.0').send(record.bundle)
      }
      const b = record.bundle
      const lists = extractLists(b)
      return {
        areas,
        fhirVersion: 'STU3',
        practice: { odsCode: endpoint.odsCode, supplier: endpoint.supplier },
        retrievedBy: actor.user.name,
        retrievedAt: new Date().toISOString(),
        warnings: lists.filter(l => l.warningCode).map(l => ({ list: l.title ?? '', code: l.warningCode!, note: l.note ?? null })),
        data: {
          ...(areas.includes('medications') ? { medications: extractMedications(b) } : {}),
          ...(areas.includes('allergies') ? { allergies: extractAllergies(b) } : {}),
          ...(areas.includes('problems') ? { problems: extractProblems(b) } : {}),
          ...(areas.includes('uncategorised') ? { observations: extractCodedData(b) } : {}),
          ...(areas.includes('consultations') ? { consultations: extractConsultations(b) } : {}),
        },
        bundle: b,
        exchange: {
          url: exchange.url,
          headers: { ...exchange.headers, Authorization: `Bearer ${exchange.headers.Authorization.slice(7, 40)}…` },
          jwtClaims: exchange.jwtClaims,
          body: exchange.body,
        },
      }
    },
  )

  // ---- Send Document to the GP practice -------------------------------------------

  const DEFAULT_TITLES: Record<DocumentKind, string> = {
    'supply-notification': 'Notification of medicine supplied or prescribed',
    'care-summary': 'Summary of care',
  }

  app.post<{
    Params: { id: string }
    Body: { kind: DocumentKind; title?: string; summary: string; medicines?: SuppliedMedicine[]; adviceForGp?: string }
  }>(
    '/api/provider/consents/:id/documents',
    {
      schema: {
        summary: "Send a document to the patient's GP practice (GP Connect Send Document over MESH). Checked and audited",
        tags,
        body: {
          type: 'object',
          required: ['kind', 'summary'],
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['supply-notification', 'care-summary'] },
            title: { type: 'string', minLength: 3, maxLength: 120 },
            summary: { type: 'string', minLength: 10, maxLength: 4000 },
            adviceForGp: { type: 'string', maxLength: 2000 },
            medicines: {
              type: 'array',
              maxItems: 20,
              items: {
                type: 'object',
                required: ['name', 'dosageInstruction', 'quantity', 'date'],
                additionalProperties: false,
                properties: {
                  name: { type: 'string', minLength: 2, maxLength: 200 },
                  dosageInstruction: { type: 'string', minLength: 2, maxLength: 500 },
                  quantity: { type: 'string', minLength: 1, maxLength: 100 },
                  date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const actor = auth(req)
      const { audit, adapters } = app.services
      const consent = await ownConsent(actor, req.params.id)
      const nhsNumber = consent.patient.nhsNumber
      const title = req.body.title ?? DEFAULT_TITLES[req.body.kind]
      const base = { type: 'access.document.send', actor: auditActor(actor), nhsNumber, consentId: consent.id, correlationId: String(req.id) }
      if (req.body.kind === 'supply-notification' && !req.body.medicines?.length) {
        throw new HttpError(400, 'invalid-request', 'A supply notification must list at least one medicine')
      }

      const patient = await adapters.pds.getPatient(nhsNumber)
      const decision = decide({
        action: 'document.send',
        actor: { userId: actor.user.userId, role: actor.user.role, active: actor.user.active, organisationOdsCode: actor.user.organisationOdsCode },
        organisation: { odsCode: actor.org.odsCode, type: actor.org.type, active: actor.org.active },
        patient: { nhsNumber, restricted: patient.restricted, deceased: patient.deceased, birthDate: patient.birthDate },
        consent,
        now: new Date(),
      })
      if (decision.decision === 'deny') {
        await audit.record({ ...base, outcome: 'denied', details: { title, reasons: decision.reasons } })
        throw new HttpError(403, 'access-denied', 'Sending to this GP practice is not permitted', { reasons: decision.reasons })
      }

      const practiceOds = patient.gp?.odsCode
      const mailbox = practiceOds ? await adapters.mesh.lookupMailbox(practiceOds, SEND_DOCUMENT_WORKFLOW_ID) : null
      if (!practiceOds || !mailbox) {
        await audit.record({ ...base, outcome: 'failure', details: { title, error: 'send-document-not-supported' } })
        throw new HttpError(
          422,
          'send-document-not-supported',
          "The patient's GP practice cannot receive documents this way. Send your summary to the practice by another secure route.",
        )
      }

      const bundle = buildSendDocumentBundle({
        doc: { kind: req.body.kind, title, date: new Date().toISOString().slice(0, 10), summary: req.body.summary, medicines: req.body.medicines ?? [], adviceForGp: req.body.adviceForGp },
        patient,
        patientName: displayName(patient),
        author: { user: actor.user, organisation: { odsCode: actor.org.odsCode, name: actor.org.name } },
        recipientOdsCode: practiceOds,
        messageId: crypto.randomUUID(),
        now: new Date(),
      })
      let messageId: string
      try {
        ;({ messageId } = await adapters.mesh.send({
          from: MIDDLEWARE.meshMailbox,
          to: mailbox,
          workflowId: SEND_DOCUMENT_WORKFLOW_ID,
          localId: consent.id,
          subject: title,
          contentType: 'application/fhir+json',
          content: bundle,
        }))
      } catch (err) {
        await audit.record({ ...base, outcome: 'failure', details: { title, error: err instanceof AdapterError ? `${err.adapter}-${err.code}` : 'unexpected' } })
        throw err
      }
      // The middleware keeps no copy of the document: only this audit entry.
      await audit.record({
        ...base,
        outcome: 'success',
        details: { messageId, kind: req.body.kind, title, practice: practiceOds, workflowId: SEND_DOCUMENT_WORKFLOW_ID, medicines: req.body.medicines?.length ?? 0 },
      })
      return reply.code(201).send({ messageId, title, status: 'accepted', practice: { odsCode: practiceOds, name: practiceByOds(practiceOds)?.name ?? practiceOds } })
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/provider/consents/:id/documents',
    { schema: { summary: 'Documents sent to the GP under this consent, with MESH delivery status', tags } },
    async req => {
      const actor = auth(req)
      requireClinician(actor)
      const consent = await ownConsent(actor, req.params.id)
      const events = (await app.services.audit.forConsent(consent.id, { limit: 500 })).filter(
        e => e.type === 'access.document.send' && e.outcome === 'success',
      )
      return Promise.all(
        events.reverse().map(async e => {
          const messageId = String(e.details?.messageId)
          let status: Awaited<ReturnType<typeof app.services.adapters.mesh.status>> = null
          try {
            status = await app.services.adapters.mesh.status(messageId)
          } catch {
            // Status is best-effort; the send itself is recorded.
          }
          return {
            messageId,
            title: String(e.details?.title ?? ''),
            kind: String(e.details?.kind ?? ''),
            sentAt: e.recordedAt,
            sentBy: providerUserById(e.actor.id)?.name ?? e.actor.id,
            status: status?.status ?? 'unknown',
            statusAt: status?.statusAt ?? null,
            statusNote: status?.statusNote ?? null,
          }
        }),
      )
    },
  )
}
