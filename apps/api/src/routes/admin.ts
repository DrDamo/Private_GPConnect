import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ADAPTER_NAMES, signToken, verifyToken, type AdapterName, type Fault } from '@pgpc/adapters'
import { CONSENT_STATUSES, effectiveStatus, PROVIDER_TYPE_LABELS, type AuditEvent, type AuditOutcome, type ConsentStatus } from '@pgpc/core'
import { ADMIN_USERS, adminUserById, PROVIDER_ORGS, PROVIDER_USERS, providerOrgByOds, providerUserById, type SimAdminUser } from '@pgpc/fixtures'
import { HttpError } from '../errors'

// Service administration: the audit trail, the consent register and (in the
// simulation) fault injection. Two least-privilege roles: auditors read;
// operators can also switch faults. Every admin read of the audit trail is
// itself audited, because who looked at the log matters as much as the log.

const tags = ['admin']
const COOKIE = 'pgpc_admin'
const COOKIE_PATH = '/api/admin'
const SESSION_TTL_MS = 4 * 60 * 60 * 1000

type AdminSession = { userId: string; exp: number }

const maskNhs = (n: string) => `*** *** ${n.slice(6)}`

export async function adminRoutes(app: FastifyInstance) {
  const key = app.services.adminSessionKey
  app.addHook('onRequest', (_req, reply, done) => {
    reply.header('Cache-Control', 'no-store')
    done()
  })

  function auth(req: FastifyRequest): SimAdminUser {
    const token = req.cookies[COOKIE]
    const session = token ? verifyToken<AdminSession>(token, key, new Date()) : null
    const user = session && adminUserById(session.userId)
    if (!user) throw new HttpError(401, 'sign-in-required', 'Please sign in')
    return user
  }

  function requireOperator(user: SimAdminUser) {
    if (user.role !== 'operator') throw new HttpError(403, 'not-permitted', 'Only service operators can change this')
  }

  const actor = (u: SimAdminUser) => ({ type: 'user' as const, id: u.userId, role: `admin:${u.role}` })

  /** Human-readable actor for the console (names are simulated staff, not patients). */
  function actorLabel(e: AuditEvent): string {
    if (e.actor.type === 'patient') return 'Patient'
    if (e.actor.type === 'system') return `System (${e.actor.id})`
    const provider = providerUserById(e.actor.id)
    if (provider) return `${provider.name}, ${providerOrgByOds(provider.organisationOdsCode)?.name ?? provider.organisationOdsCode}`
    return adminUserById(e.actor.id)?.name ?? e.actor.id
  }

  // ---- Simulated sign-in ------------------------------------------------------

  app.get('/api/admin/sim/users', { schema: { summary: 'Simulator: service staff you can sign in as', tags } }, async () => ADMIN_USERS)

  app.post<{ Body: { userId: string } }>(
    '/api/admin/sim-login',
    {
      schema: {
        summary: 'Simulator: sign in as service staff',
        tags,
        body: { type: 'object', required: ['userId'], properties: { userId: { type: 'string', maxLength: 100 } } },
      },
    },
    async (req, reply) => {
      const user = adminUserById(req.body.userId)
      if (!user) throw new HttpError(404, 'not-found', 'Unknown user')
      reply.setCookie(COOKIE, signToken({ userId: user.userId, exp: Date.now() + SESSION_TTL_MS }, key), {
        path: COOKIE_PATH,
        httpOnly: true,
        sameSite: 'strict',
        secure: req.protocol === 'https',
        maxAge: SESSION_TTL_MS / 1000,
      })
      await app.services.audit.record({ type: 'admin.signed-in', outcome: 'success', actor: actor(user), correlationId: String(req.id) })
      return { ok: true }
    },
  )

  app.post('/api/admin/logout', { schema: { summary: 'Sign out', tags } }, async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: COOKIE_PATH })
    return { ok: true }
  })

  app.get('/api/admin/session', { schema: { summary: 'Who is signed in', tags } }, async req => auth(req))

  // ---- Overview ------------------------------------------------------------------

  app.get('/api/admin/overview', { schema: { summary: 'Service at a glance', tags } }, async req => {
    auth(req)
    const now = new Date()
    const consents = await app.services.consentRepository.list({ limit: 5000 })
    const byStatus = Object.fromEntries(CONSENT_STATUSES.map(s => [s, 0])) as Record<ConsentStatus, number>
    for (const c of consents) byStatus[effectiveStatus(c, now)]++
    const recent = await app.services.audit.latest({ limit: 500 })
    return {
      store: app.services.storeKind,
      consents: byStatus,
      audit: {
        lastSeq: recent[0]?.seq ?? 0,
        recentWindow: recent.length,
        recentDenied: recent.filter(e => e.outcome === 'denied').length,
        recentFailures: recent.filter(e => e.outcome === 'failure').length,
        recentRecordAccess: recent.filter(e => e.type.startsWith('access.') && e.outcome === 'success').length,
      },
      faults: await app.services.simulator.faults.all(),
    }
  })

  // ---- Audit trail ---------------------------------------------------------------

  app.get<{
    Querystring: { limit?: number; beforeSeq?: number; type?: string; outcome?: AuditOutcome; consentId?: string; nhsNumber?: string }
  }>(
    '/api/admin/audit',
    {
      schema: {
        summary: 'Audit trail, newest first. Searching by NHS number uses its pseudonym; the search itself is audited',
        tags,
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            beforeSeq: { type: 'integer', minimum: 1 },
            type: { type: 'string', pattern: '^[a-z.-]{1,60}$' },
            outcome: { type: 'string', enum: ['success', 'denied', 'failure'] },
            consentId: { type: 'string', format: 'uuid' },
            nhsNumber: { type: 'string', pattern: '^[0-9]{10}$' },
          },
        },
      },
    },
    async req => {
      const user = auth(req)
      const { nhsNumber, ...filters } = req.query
      const events = await app.services.audit.latest({
        ...filters,
        limit: filters.limit ?? 50,
        ...(nhsNumber ? { patientRef: app.services.audit.patientRef(nhsNumber) } : {}),
      })
      await app.services.audit.record({
        type: 'admin.audit.view',
        outcome: 'success',
        actor: actor(user),
        ...(nhsNumber ? { nhsNumber } : {}),
        correlationId: String(req.id),
        details: { filters: JSON.stringify({ ...filters, ...(nhsNumber ? { nhsNumber: 'pseudonymised' } : {}) }), returned: events.length },
      })
      return events.map(e => ({
        seq: e.seq,
        recordedAt: e.recordedAt,
        type: e.type,
        outcome: e.outcome,
        actor: actorLabel(e),
        actorType: e.actor.type,
        patientRef: e.patientRef ? e.patientRef.slice(0, 10) : null,
        consentId: e.consentId ?? null,
        correlationId: e.correlationId,
        details: e.details ?? null,
        hash: e.hash,
        prevHash: e.prevHash,
      }))
    },
  )

  app.get('/api/admin/audit/verify', { schema: { summary: 'Verify the whole hash chain', tags } }, async req => {
    const user = auth(req)
    const started = Date.now()
    const result = await app.services.audit.verify()
    await app.services.audit.record({
      type: 'admin.audit.verify',
      outcome: result.valid ? 'success' : 'failure',
      actor: actor(user),
      correlationId: String(req.id),
      details: { valid: result.valid, checked: result.checked },
    })
    return { ...result, durationMs: Date.now() - started, verifiedAt: new Date().toISOString() }
  })

  // ---- Consent register ----------------------------------------------------------

  app.get<{ Querystring: { status?: ConsentStatus } }>(
    '/api/admin/consents',
    {
      schema: {
        summary: 'Consent register (NHS numbers masked)',
        tags,
        querystring: { type: 'object', properties: { status: { type: 'string', enum: [...CONSENT_STATUSES] } } },
      },
    },
    async req => {
      auth(req)
      const now = new Date()
      // Expiry is time-based, so filter on the effective status.
      const records = await app.services.consentRepository.list({ limit: 1000 })
      return records
        .map(c => ({
          id: c.id,
          status: effectiveStatus(c, now),
          patient: maskNhs(c.patient.nhsNumber),
          provider: c.provider.name,
          providerType: PROVIDER_TYPE_LABELS[c.provider.type],
          purpose: c.episode.purpose,
          requestedBy: c.requestedBy.name,
          requestedAt: c.requestedAt,
          assurance: c.decision?.assurance ?? null,
          actions: c.scope.actions,
          expiresAt: c.expiresAt ?? null,
          withdrawnBy: c.withdrawal?.by ?? null,
        }))
        .filter(c => !req.query.status || c.status === req.query.status)
    },
  )

  app.get('/api/admin/providers', { schema: { summary: 'Provider organisations and staff', tags } }, async req => {
    auth(req)
    return PROVIDER_ORGS.map(o => ({
      ...o,
      typeLabel: PROVIDER_TYPE_LABELS[o.type],
      users: PROVIDER_USERS.filter(u => u.organisationOdsCode === o.odsCode),
    }))
  })

  // ---- Fault injection (simulation only) -------------------------------------------

  app.get('/api/admin/faults', { schema: { summary: 'Current simulated faults per national service', tags } }, async req => {
    auth(req)
    const faults = await app.services.simulator.faults.all()
    return ADAPTER_NAMES.map(a => ({ adapter: a, fault: faults[a] ?? null }))
  })

  app.put<{ Params: { adapter: AdapterName }; Body: { kind: 'none' | Fault['kind']; ms?: number } }>(
    '/api/admin/faults/:adapter',
    {
      schema: {
        summary: 'Make a simulated national service slow, time out or fail (operators only)',
        tags,
        params: { type: 'object', properties: { adapter: { type: 'string', enum: ADAPTER_NAMES } } },
        body: {
          type: 'object',
          required: ['kind'],
          properties: {
            kind: { type: 'string', enum: ['none', 'timeout', 'unavailable', 'latency'] },
            ms: { type: 'integer', minimum: 100, maximum: 10000 },
          },
        },
      },
    },
    async req => {
      const user = auth(req)
      requireOperator(user)
      const { kind, ms } = req.body
      const fault: Fault | null = kind === 'none' ? null : kind === 'latency' ? { kind, ms: ms ?? 2000 } : { kind }
      await app.services.simulator.faults.set(req.params.adapter, fault)
      await app.services.audit.record({
        type: 'admin.fault.set',
        outcome: 'success',
        actor: actor(user),
        correlationId: String(req.id),
        details: { adapter: req.params.adapter, kind, ...(fault?.kind === 'latency' ? { ms: fault.ms } : {}) },
      })
      return { adapter: req.params.adapter, fault }
    },
  )
}
