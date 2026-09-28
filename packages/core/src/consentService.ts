import type { AuditActor, AuditLog } from './audit'
import {
  ConsentError,
  createConsentRequest,
  declineConsent,
  effectiveStatus,
  grantConsent,
  withdrawConsent,
  type ConsentRecord,
  type ConsentRequestInput,
  type PatientDecisionInput,
} from './consent'
import type { ConsentRepository } from './stores'
import type { JsonValue } from './types'

// Orchestrates the pure consent transitions with persistence and audit. Every
// state change is audited after it is stored; a failed attempt is audited too.

export interface ConsentServiceOptions {
  repository: ConsentRepository
  audit: AuditLog
  clock?: () => Date
  newId?: () => string
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`)
    this.name = 'NotFoundError'
  }
}

type Ctx = { correlationId: string }

function scopeDetails(record: ConsentRecord): { [key: string]: JsonValue } {
  return {
    status: record.status,
    providerType: record.provider.type,
    actions: record.scope.actions,
    htmlSections: record.scope.htmlSections,
    clinicalAreas: record.scope.clinicalAreas,
    expiresAt: record.expiresAt ?? null,
  }
}

export class ConsentService {
  private readonly repository: ConsentRepository
  private readonly audit: AuditLog
  private readonly clock: () => Date
  private readonly newId: () => string

  constructor(options: ConsentServiceOptions) {
    this.repository = options.repository
    this.audit = options.audit
    this.clock = options.clock ?? (() => new Date())
    this.newId = options.newId ?? (() => crypto.randomUUID())
  }

  async request(input: Omit<ConsentRequestInput, 'id'>, ctx: Ctx): Promise<ConsentRecord> {
    const actor: AuditActor = {
      type: 'user',
      id: input.requestedBy.userId,
      organisationOdsCode: input.provider.odsCode,
      role: input.requestedBy.role,
    }
    let record: ConsentRecord
    try {
      record = createConsentRequest({ ...input, id: this.newId() }, this.clock())
    } catch (err) {
      await this.auditFailure('consent.requested', actor, input.nhsNumber, undefined, err, ctx)
      throw err
    }
    await this.repository.insert(record)
    await this.audit.record({
      type: 'consent.requested',
      outcome: 'success',
      actor,
      nhsNumber: record.patient.nhsNumber,
      consentId: record.id,
      correlationId: ctx.correlationId,
      details: { ...scopeDetails(record), episodeId: record.episode.id },
    })
    return record
  }

  grant(id: string, input: PatientDecisionInput, ctx: Ctx) {
    return this.patientDecision(id, input, ctx, 'consent.granted', grantConsent)
  }

  decline(id: string, input: PatientDecisionInput, ctx: Ctx) {
    return this.patientDecision(id, input, ctx, 'consent.declined', declineConsent)
  }

  async withdraw(
    id: string,
    by: { kind: 'patient' | 'provider' | 'admin'; actor: AuditActor },
    reason: string | undefined,
    ctx: Ctx,
  ): Promise<ConsentRecord> {
    return this.transition(id, 'consent.withdrawn', by.actor, ctx, (record, now) =>
      withdrawConsent(record, by.kind, now, reason),
    )
  }

  /** Current record with its time-dependent status applied. */
  async get(id: string): Promise<ConsentRecord | null> {
    const record = await this.repository.get(id)
    return record && { ...record, status: effectiveStatus(record, this.clock()) }
  }

  private patientDecision(
    id: string,
    input: PatientDecisionInput,
    ctx: Ctx,
    type: string,
    apply: (r: ConsentRecord, i: PatientDecisionInput, now: Date) => ConsentRecord,
  ) {
    const actor: AuditActor = { type: 'patient', id: input.evidence.subject }
    return this.transition(id, type, actor, ctx, (record, now) => apply(record, input, now), {
      assurance: input.assurance,
      channel: input.evidence.channel,
      consentTextVersion: input.evidence.consentTextVersion,
    })
  }

  private async transition(
    id: string,
    type: string,
    actor: AuditActor,
    ctx: Ctx,
    apply: (record: ConsentRecord, now: Date) => ConsentRecord,
    extraDetails: { [key: string]: JsonValue } = {},
  ): Promise<ConsentRecord> {
    const current = await this.repository.get(id)
    if (!current) throw new NotFoundError(`Consent ${id}`)

    let next: ConsentRecord
    try {
      next = apply(current, this.clock())
    } catch (err) {
      await this.auditFailure(type, actor, current.patient.nhsNumber, id, err, ctx)
      throw err
    }
    await this.repository.update(next)
    await this.audit.record({
      type,
      outcome: 'success',
      actor,
      nhsNumber: next.patient.nhsNumber,
      consentId: id,
      correlationId: ctx.correlationId,
      details: { ...scopeDetails(next), ...extraDetails },
    })
    return next
  }

  private async auditFailure(
    type: string,
    actor: AuditActor,
    nhsNumber: string,
    consentId: string | undefined,
    err: unknown,
    ctx: Ctx,
  ) {
    await this.audit.record({
      type,
      outcome: 'failure',
      actor,
      nhsNumber,
      ...(consentId ? { consentId } : {}),
      correlationId: ctx.correlationId,
      details: {
        error: err instanceof ConsentError ? err.code : 'unexpected',
        message: err instanceof Error ? err.message : String(err),
      },
    })
  }
}
