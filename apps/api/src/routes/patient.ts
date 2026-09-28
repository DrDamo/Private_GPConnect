import type { FastifyInstance, FastifyRequest } from 'fastify'
import { displayName } from '@pgpc/adapters'
import { providerOrgByOds } from '@pgpc/fixtures'
import {
  ACTION_LABELS,
  CLINICAL_AREA_LABELS,
  CONSENT_TEXT_VERSION,
  consentTextHash,
  effectiveOffer,
  effectiveStatus,
  HTML_SECTION_LABELS,
  PROVIDER_TYPE_LABELS,
  renderConsentText,
  type AssuranceLevel,
  type AuditEvent,
  type ConsentRecord,
  type HtmlSection,
} from '@pgpc/core'
import { HttpError } from '../errors'
import {
  clearSession,
  isSafeReturnPath,
  maskMobile,
  readSession,
  takeOidcState,
  writeOidcState,
  writeSession,
  type PatientSession,
} from '../session'

// The patient side of consent (PLAN.md §4.3):
// - sign in with NHS login (P9) or, as a fallback, a text-message code plus
//   date of birth sent to the mobile number on PDS
// - review a request, agree or decline, withdraw later
// - see every consent and every access to their record (NHS login only)
//
// Nothing identifying is shown before sign-in: the link in the text message is
// not proof of identity, and even the provider's name can be sensitive.

const tags = ['patient']
const CALLBACK_PATH = '/patient/callback'

const correlation = (req: FastifyRequest) => ({ correlationId: String(req.id) })

function requireSession(req: FastifyRequest, key: string): PatientSession {
  const session = readSession(req, key)
  if (!session) throw new HttpError(401, 'sign-in-required', 'Please sign in')
  return session
}

function requireNhsLogin(session: PatientSession) {
  if (session.assurance !== 'nhs-login-p9') {
    throw new HttpError(403, 'nhs-login-required', 'Sign in with NHS login to see this')
  }
}

/** A consent the signed-in patient may act on, or 404 (never reveal others exist). */
async function loadOwnConsent(app: FastifyInstance, session: PatientSession, id: string): Promise<ConsentRecord> {
  const record = /^[0-9a-f-]{36}$/i.test(id) ? await app.services.consentRepository.get(id) : null
  const allowed =
    record &&
    record.patient.nhsNumber === session.nhsNumber &&
    (session.assurance === 'nhs-login-p9' || session.consentId === id)
  if (!record || !allowed) throw new HttpError(404, 'not-found', 'Request not found')
  return record
}

function consentView(record: ConsentRecord, assurance: AssuranceLevel, now = new Date()) {
  const status = effectiveStatus(record, now)
  const offer = effectiveOffer(record, assurance)
  // What is (or was) actually in force, once decided; what is on offer while pending.
  const grantedDays =
    record.validFrom && record.expiresAt
      ? Math.round((Date.parse(record.expiresAt) - Date.parse(record.validFrom)) / 86_400_000)
      : record.requestedDurationDays
  const scope = status === 'pending' ? offer : { ...record.scope, durationDays: grantedDays }
  const text = renderConsentText(record, assurance)
  return {
    id: record.id,
    status,
    provider: { name: record.provider.name, type: record.provider.type, typeLabel: PROVIDER_TYPE_LABELS[record.provider.type] },
    purpose: record.episode.purpose,
    requestedBy: record.requestedBy.name,
    requestedAt: record.requestedAt,
    requestExpiresAt: record.requestExpiresAt,
    permissions: scope.actions.map(a => ACTION_LABELS[a]),
    recordParts: [
      ...new Set([
        ...scope.htmlSections.map(s => HTML_SECTION_LABELS[s]),
        ...scope.clinicalAreas.map(a => CLINICAL_AREA_LABELS[a]),
      ]),
    ],
    durationDays: scope.durationDays,
    narrowedBySignIn: status === 'pending' && offer.narrowed,
    decision: record.decision ? { outcome: record.decision.outcome, at: record.decision.at, via: record.decision.evidence.channel } : null,
    validFrom: record.validFrom ?? null,
    expiresAt: record.expiresAt ?? null,
    withdrawal: record.withdrawal ? { at: record.withdrawal.at, by: record.withdrawal.by } : null,
    ...(status === 'pending'
      ? { consentText: text, consentTextVersion: CONSENT_TEXT_VERSION, consentTextHash: consentTextHash(text) }
      : {}),
  }
}

/** Plain-English description of an audit event for the patient's access log. */
function describeEvent(e: AuditEvent, providerFor: (consentId?: string, ods?: string) => string): string | null {
  const provider = providerFor(e.consentId, e.actor.organisationOdsCode)
  const failed = e.outcome !== 'success'
  switch (e.type) {
    case 'consent.requested':
      return failed ? `${provider} tried to ask for your consent, but it was refused` : `${provider} asked for your consent to see your GP record`
    case 'consent.notification':
      return failed ? `We could not send you a text message about a request from ${provider}` : `We sent you a text message about a request from ${provider}`
    case 'patient.sms-code-sent':
      return 'A sign-in code was sent to your mobile'
    case 'patient.sms-verified':
      return failed ? 'Someone entered a wrong sign-in code or date of birth' : 'Signed in with a text message code'
    case 'patient.signed-in':
      return failed ? 'A sign-in with NHS login was not accepted' : 'Signed in with NHS login'
    case 'consent.granted':
      return failed ? `An attempt to agree to ${provider}'s request did not succeed` : `You agreed to ${provider}'s request`
    case 'consent.declined':
      return failed ? `An attempt to decline ${provider}'s request did not succeed` : `You declined ${provider}'s request`
    case 'consent.withdrawn':
      if (failed) return `An attempt to withdraw consent from ${provider} did not succeed`
      return e.actor.type === 'patient' ? `You withdrew consent from ${provider}` : `${provider}'s access was ended`
    case 'pds.retrieve':
    case 'pds.search':
      return failed ? null : `${provider} looked up your details on the NHS Spine`
    case 'access.html.view': {
      const code = e.details?.section as HtmlSection | undefined
      const part = code && HTML_SECTION_LABELS[code] ? HTML_SECTION_LABELS[code].toLowerCase() : 'GP record'
      if (e.outcome === 'denied') return `${provider} tried to look at your ${part} but was not allowed`
      if (failed) return `${provider} tried to look at your ${part} but your GP system could not be reached`
      return `${provider} looked at your ${part}`
    }
    default:
      if (e.type.startsWith('access.')) {
        return failed ? `${provider} tried to access your record but was refused` : `${provider} accessed your GP record`
      }
      return null
  }
}

export async function patientRoutes(app: FastifyInstance) {
  const key = app.services.sessionKey
  app.addHook('onRequest', (_req, reply, done) => {
    reply.header('Cache-Control', 'no-store')
    done()
  })

  app.get('/api/patient/session', { schema: { summary: 'Who is signed in, if anyone', tags } }, async req => {
    const session = readSession(req, key)
    if (!session) return { authenticated: false }
    let name: string | null = null
    try {
      name = displayName(await app.services.adapters.pds.getPatient(session.nhsNumber))
    } catch {
      // Name is a nicety; the session is still valid if PDS is down.
    }
    return {
      authenticated: true,
      assurance: session.assurance,
      name,
      consentId: session.consentId ?? null,
      expiresAt: new Date(session.exp).toISOString(),
    }
  })

  app.post('/api/patient/logout', { schema: { summary: 'Sign out', tags } }, async (_req, reply) => {
    clearSession(reply)
    return { ok: true }
  })

  // ---- NHS login ---------------------------------------------------------

  app.post<{ Body: { returnTo: string } }>(
    '/api/patient/nhs-login/start',
    {
      schema: {
        summary: 'Start NHS login: returns the URL to send the patient to',
        tags,
        body: { type: 'object', required: ['returnTo'], properties: { returnTo: { type: 'string', maxLength: 200 } } },
      },
    },
    async (req, reply) => {
      if (!isSafeReturnPath(req.body.returnTo)) throw new HttpError(400, 'invalid-request', 'returnTo must be a same-site path')
      const state = crypto.randomUUID()
      const nonce = crypto.randomUUID()
      writeOidcState(req, reply, key, { state, nonce, returnTo: req.body.returnTo })
      return { authorizationUrl: app.services.adapters.nhsLogin.authorizationUrl({ state, nonce, redirectUri: CALLBACK_PATH }) }
    },
  )

  app.post<{ Body: { code: string; state: string } }>(
    '/api/patient/nhs-login/callback',
    {
      schema: {
        summary: 'Finish NHS login: exchange the code and start a patient session',
        tags,
        body: {
          type: 'object',
          required: ['code', 'state'],
          properties: { code: { type: 'string', maxLength: 2000 }, state: { type: 'string', maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const saved = takeOidcState(req, reply, key)
      if (!saved || saved.state !== req.body.state) {
        throw new HttpError(400, 'sign-in-expired', 'Your sign-in expired or was started elsewhere. Please try again.')
      }
      const identity = await app.services.adapters.nhsLogin.exchangeCode({
        code: req.body.code,
        redirectUri: CALLBACK_PATH,
        nonce: saved.nonce,
      })
      if (identity.identityProofingLevel !== 'P9' || !identity.nhsNumber) {
        await app.services.audit.record({
          type: 'patient.signed-in',
          outcome: 'denied',
          actor: { type: 'patient', id: identity.sub },
          correlationId: String(req.id),
          details: { channel: 'nhs-login', identityProofingLevel: identity.identityProofingLevel },
        })
        throw new HttpError(
          403,
          'identity-not-verified',
          'Your NHS login has not been fully verified yet. Prove who you are in the NHS App or NHS login, then try again.',
        )
      }
      writeSession(req, reply, key, { nhsNumber: identity.nhsNumber, assurance: 'nhs-login-p9', subject: identity.sub })
      await app.services.audit.record({
        type: 'patient.signed-in',
        outcome: 'success',
        actor: { type: 'patient', id: identity.sub },
        nhsNumber: identity.nhsNumber,
        correlationId: String(req.id),
        details: { channel: 'nhs-login' },
      })
      return { returnTo: saved.returnTo }
    },
  )

  // ---- Text message code (fallback) ---------------------------------------

  app.post<{ Body: { consentId: string } }>(
    '/api/patient/sms/start',
    {
      schema: {
        summary: 'Text a sign-in code to the mobile number on PDS for this request',
        tags,
        body: { type: 'object', required: ['consentId'], properties: { consentId: { type: 'string', format: 'uuid' } } },
      },
    },
    async req => {
      const { consentRepository, adapters, otp, audit } = app.services
      const record = await consentRepository.get(req.body.consentId)
      // Same response for unknown and non-pending requests: the link is not a secret.
      if (!record || effectiveStatus(record, new Date()) !== 'pending') {
        throw new HttpError(409, 'request-not-open', 'This request is no longer open')
      }
      const patient = await adapters.pds.getPatient(record.patient.nhsNumber)
      if (!patient.mobile) {
        throw new HttpError(422, 'no-mobile', 'We do not have a mobile number for you. Please use NHS login instead.')
      }
      const issued = await otp.issue(record.id, patient.mobile)
      if (!issued.ok) throw new HttpError(429, 'too-many-codes', 'Too many codes requested. Wait 15 minutes or use NHS login.')
      await adapters.sms.send({
        to: patient.mobile,
        body: `SIMULATION. Your sign-in code is ${issued.code}. It expires in 10 minutes. Never share it with anyone.`,
        reference: record.id,
      })
      await audit.record({
        type: 'patient.sms-code-sent',
        outcome: 'success',
        actor: { type: 'system', id: 'otp' },
        nhsNumber: record.patient.nhsNumber,
        consentId: record.id,
        correlationId: String(req.id),
      })
      return { challengeId: issued.challenge.id, sentTo: maskMobile(patient.mobile) }
    },
  )

  app.post<{ Body: { challengeId: string; code: string; birthDate: string } }>(
    '/api/patient/sms/verify',
    {
      schema: {
        summary: 'Check the code and date of birth, and start a session limited to this request',
        tags,
        body: {
          type: 'object',
          required: ['challengeId', 'code', 'birthDate'],
          properties: {
            challengeId: { type: 'string', format: 'uuid' },
            code: { type: 'string', maxLength: 10 },
            birthDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
      },
    },
    async (req, reply) => {
      const { otp, consentRepository, adapters, audit } = app.services
      const challenge = await otp.getChallenge(req.body.challengeId)
      const record = challenge ? await consentRepository.get(challenge.subjectRef) : null
      if (!challenge || !record) throw new HttpError(400, 'code-invalid', 'That code is not valid. Request a new one.')
      const patient = await adapters.pds.getPatient(record.patient.nhsNumber)

      const result = await otp.verify(req.body.challengeId, req.body.code, () => patient.birthDate === req.body.birthDate)
      await audit.record({
        type: 'patient.sms-verified',
        outcome: result.ok ? 'success' : 'denied',
        actor: { type: 'patient', id: maskMobile(challenge.destination) },
        nhsNumber: record.patient.nhsNumber,
        consentId: record.id,
        correlationId: String(req.id),
        ...(result.ok ? {} : { details: { reason: result.reason } }),
      })
      if (!result.ok) {
        const messages: Record<typeof result.reason, string> = {
          'wrong-code': 'The code or date of birth is not right.',
          'too-many-attempts': 'Too many wrong attempts. Request a new code or use NHS login.',
          expired: 'That code has expired. Request a new one.',
          consumed: 'That code has already been used. Request a new one.',
          'not-found': 'That code is not valid. Request a new one.',
        }
        throw new HttpError(400, `code-${result.reason}`, messages[result.reason], {
          ...(result.attemptsLeft !== undefined ? { attemptsLeft: result.attemptsLeft } : {}),
        })
      }
      writeSession(req, reply, key, {
        nhsNumber: record.patient.nhsNumber,
        assurance: 'sms-otp',
        subject: maskMobile(challenge.destination),
        consentId: record.id,
      })
      return { ok: true, consentId: record.id }
    },
  )

  // ---- Consents -----------------------------------------------------------

  app.get<{ Params: { id: string } }>(
    '/api/patient/consents/:id',
    { schema: { summary: 'A request or consent, as the signed-in patient sees it', tags } },
    async req => {
      const session = requireSession(req, key)
      return consentView(await loadOwnConsent(app, session, req.params.id), session.assurance)
    },
  )

  app.post<{ Params: { id: string }; Body: { decision: 'grant' | 'decline'; consentTextVersion: string; consentTextHash: string } }>(
    '/api/patient/consents/:id/decision',
    {
      schema: {
        summary: 'Agree to or decline a request',
        tags,
        body: {
          type: 'object',
          required: ['decision', 'consentTextVersion', 'consentTextHash'],
          properties: {
            decision: { type: 'string', enum: ['grant', 'decline'] },
            consentTextVersion: { type: 'string', maxLength: 50 },
            consentTextHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          },
        },
      },
    },
    async req => {
      const session = requireSession(req, key)
      const record = await loadOwnConsent(app, session, req.params.id)
      // The patient must be agreeing to exactly the words we would show now.
      const text = renderConsentText(record, session.assurance)
      if (req.body.consentTextVersion !== CONSENT_TEXT_VERSION || req.body.consentTextHash !== consentTextHash(text)) {
        throw new HttpError(409, 'text-changed', 'The wording has changed. Please read it again.')
      }
      const input = {
        assurance: session.assurance,
        verifiedNhsNumber: session.nhsNumber,
        evidence: {
          channel: session.assurance === 'nhs-login-p9' ? ('nhs-login' as const) : ('sms' as const),
          subject: session.subject,
          consentTextVersion: CONSENT_TEXT_VERSION,
          consentTextHash: req.body.consentTextHash,
        },
      }
      const updated =
        req.body.decision === 'grant'
          ? await app.services.consents.grant(record.id, input, correlation(req))
          : await app.services.consents.decline(record.id, input, correlation(req))
      return consentView(updated, session.assurance)
    },
  )

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/patient/consents/:id/withdraw',
    {
      schema: {
        summary: 'Withdraw consent (takes effect immediately)',
        tags,
        body: { type: 'object', properties: { reason: { type: 'string', maxLength: 500 } } },
      },
    },
    async req => {
      const session = requireSession(req, key)
      const record = await loadOwnConsent(app, session, req.params.id)
      const updated = await app.services.consents.withdraw(
        record.id,
        { kind: 'patient', actor: { type: 'patient', id: session.subject } },
        req.body?.reason,
        correlation(req),
      )
      return consentView(updated, session.assurance)
    },
  )

  app.get('/api/patient/me/consents', { schema: { summary: 'All my requests and consents (NHS login only)', tags } }, async req => {
    const session = requireSession(req, key)
    requireNhsLogin(session)
    const records = await app.services.consentRepository.listByPatient(session.nhsNumber)
    return records.map(r => consentView(r, session.assurance))
  })

  app.get('/api/patient/me/access-log', { schema: { summary: 'Everything that has happened with my record (NHS login only)', tags } }, async req => {
    const session = requireSession(req, key)
    requireNhsLogin(session)
    const [events, records] = await Promise.all([
      app.services.audit.forPatient(session.nhsNumber, { limit: 500 }),
      app.services.consentRepository.listByPatient(session.nhsNumber),
    ])
    const byId = new Map(records.map(r => [r.id, r.provider.name]))
    const byOds = new Map(records.map(r => [r.provider.odsCode, r.provider.name]))
    const providerFor = (consentId?: string, ods?: string) =>
      (consentId && byId.get(consentId)) ||
      (ods && (byOds.get(ods) ?? providerOrgByOds(ods)?.name)) ||
      'A healthcare provider'
    return events
      .map(e => ({ at: e.recordedAt, outcome: e.outcome, description: describeEvent(e, providerFor), seq: e.seq }))
      .filter((e): e is { at: string; outcome: AuditEvent['outcome']; description: string; seq: number } => e.description !== null)
      .reverse()
  })
}

