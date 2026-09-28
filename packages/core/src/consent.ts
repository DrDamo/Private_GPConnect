import { ASSURANCE_RULES, PROVIDER_PROFILES, REQUEST_TTL_DAYS } from './profiles'
import type {
  AssuranceLevel,
  ConsentAction,
  ConsentScope,
  ConsentStatus,
  ProviderType,
  UserRole,
} from './types'

// Consent lifecycle as pure functions. Each transition takes a record and
// returns a new one (with version + 1) or throws ConsentError; persistence and
// audit are the caller's job (see ConsentService).
//
//   pending ──grant──▶ active ──withdraw──▶ withdrawn
//      │                  └──(time)──▶ expired
//      ├──decline──▶ declined
//      ├──withdraw──▶ withdrawn   (provider cancels the request)
//      └──(time)──▶ expired

export interface ConsentEvidence {
  channel: 'nhs-login' | 'sms'
  /** NHS login `sub`, or a masked mobile number for SMS. */
  subject: string
  /** Version and SHA-256 of the exact wording shown to the patient. */
  consentTextVersion: string
  consentTextHash: string
}

export interface ConsentRecord {
  id: string
  version: number
  status: ConsentStatus
  patient: { nhsNumber: string }
  provider: { odsCode: string; name: string; type: ProviderType }
  episode: { id: string; purpose: string }
  requestedBy: { userId: string; name: string; role: UserRole }
  requestedAt: string
  requestExpiresAt: string
  scope: ConsentScope
  requestedDurationDays: number
  decision?: {
    outcome: 'granted' | 'declined'
    at: string
    assurance: AssuranceLevel
    evidence: ConsentEvidence
  }
  validFrom?: string
  expiresAt?: string
  withdrawal?: { at: string; by: 'patient' | 'provider' | 'admin'; reason?: string }
}

export type ConsentErrorCode =
  | 'invalid-scope'
  | 'invalid-duration'
  | 'invalid-transition'
  | 'request-expired'
  | 'identity-mismatch'
  | 'assurance-insufficient'

export class ConsentError extends Error {
  readonly code: ConsentErrorCode
  constructor(code: ConsentErrorCode, message: string) {
    super(message)
    this.name = 'ConsentError'
    this.code = code
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS)

function isSubset<T>(items: readonly T[], allowed: readonly T[]): boolean {
  return items.every(i => allowed.includes(i))
}

export interface ConsentRequestInput {
  id: string
  nhsNumber: string
  provider: { odsCode: string; name: string; type: ProviderType }
  episode: { id: string; purpose: string }
  requestedBy: { userId: string; name: string; role: UserRole }
  /** Defaults to the full profile for the provider type. */
  scope?: ConsentScope
  durationDays?: number
}

export function createConsentRequest(input: ConsentRequestInput, now: Date): ConsentRecord {
  const profile = PROVIDER_PROFILES[input.provider.type]
  const scope = input.scope ?? profile.scope

  if (
    scope.actions.length === 0 ||
    !isSubset(scope.actions, profile.scope.actions) ||
    !isSubset(scope.htmlSections, profile.scope.htmlSections) ||
    !isSubset(scope.clinicalAreas, profile.scope.clinicalAreas)
  ) {
    throw new ConsentError('invalid-scope', `Scope exceeds the ${profile.label} profile`)
  }
  if (scope.actions.includes('html.view') && scope.htmlSections.length === 0) {
    throw new ConsentError('invalid-scope', 'html.view requires at least one HTML section')
  }
  if (scope.actions.includes('structured.retrieve') && scope.clinicalAreas.length === 0) {
    throw new ConsentError('invalid-scope', 'structured.retrieve requires at least one clinical area')
  }

  const durationDays = input.durationDays ?? profile.defaultDurationDays
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > profile.maxDurationDays) {
    throw new ConsentError('invalid-duration', `Duration must be 1–${profile.maxDurationDays} days`)
  }

  return {
    id: input.id,
    version: 1,
    status: 'pending',
    patient: { nhsNumber: input.nhsNumber },
    provider: input.provider,
    episode: input.episode,
    requestedBy: input.requestedBy,
    requestedAt: now.toISOString(),
    requestExpiresAt: addDays(now, REQUEST_TTL_DAYS).toISOString(),
    scope: {
      actions: [...scope.actions],
      htmlSections: [...scope.htmlSections],
      clinicalAreas: [...scope.clinicalAreas],
    },
    requestedDurationDays: durationDays,
  }
}

/** Status taking the clock into account: lapsed requests and consents read as expired. */
export function effectiveStatus(record: ConsentRecord, now: Date): ConsentStatus {
  if (record.status === 'pending' && now >= new Date(record.requestExpiresAt)) return 'expired'
  if (record.status === 'active' && record.expiresAt && now >= new Date(record.expiresAt)) return 'expired'
  return record.status
}

function requirePending(record: ConsentRecord, now: Date, verb: string) {
  const status = effectiveStatus(record, now)
  if (status === 'expired' && record.status === 'pending') {
    throw new ConsentError('request-expired', `Cannot ${verb}: the request has expired`)
  }
  if (status !== 'pending') {
    throw new ConsentError('invalid-transition', `Cannot ${verb} a consent that is ${status}`)
  }
}

export interface PatientDecisionInput {
  assurance: AssuranceLevel
  evidence: ConsentEvidence
  /** NHS number of the person who authenticated (from NHS login or the SMS journey). */
  verifiedNhsNumber: string
}

function checkIdentity(record: ConsentRecord, input: PatientDecisionInput) {
  if (input.verifiedNhsNumber !== record.patient.nhsNumber) {
    throw new ConsentError('identity-mismatch', 'Authenticated patient does not match the request')
  }
}

/**
 * Patient grants consent. The scope is narrowed to what the assurance level may
 * authorise (e.g. SMS → view only) and the duration capped accordingly.
 */
export function grantConsent(record: ConsentRecord, input: PatientDecisionInput, now: Date): ConsentRecord {
  requirePending(record, now, 'grant')
  checkIdentity(record, input)

  const rule = ASSURANCE_RULES[input.assurance]
  const actions = record.scope.actions.filter((a: ConsentAction) => rule.allowedActions.includes(a))
  if (actions.length === 0) {
    throw new ConsentError(
      'assurance-insufficient',
      `${input.assurance} cannot authorise any of the requested actions`,
    )
  }
  const durationDays = Math.min(record.requestedDurationDays, rule.maxDurationDays)

  return {
    ...record,
    version: record.version + 1,
    status: 'active',
    scope: {
      actions,
      htmlSections: actions.includes('html.view') ? record.scope.htmlSections : [],
      clinicalAreas: actions.includes('structured.retrieve') ? record.scope.clinicalAreas : [],
    },
    decision: { outcome: 'granted', at: now.toISOString(), assurance: input.assurance, evidence: input.evidence },
    validFrom: now.toISOString(),
    expiresAt: addDays(now, durationDays).toISOString(),
  }
}

export function declineConsent(record: ConsentRecord, input: PatientDecisionInput, now: Date): ConsentRecord {
  requirePending(record, now, 'decline')
  checkIdentity(record, input)
  return {
    ...record,
    version: record.version + 1,
    status: 'declined',
    decision: { outcome: 'declined', at: now.toISOString(), assurance: input.assurance, evidence: input.evidence },
  }
}

/**
 * End an active consent (anyone: the patient withdraws, or the provider closes
 * the episode early), or cancel a pending request (provider/admin; a patient
 * declines instead). Takes effect immediately; data already retrieved is not
 * recalled (PLAN.md §2.5).
 */
export function withdrawConsent(
  record: ConsentRecord,
  by: 'patient' | 'provider' | 'admin',
  now: Date,
  reason?: string,
): ConsentRecord {
  const status = effectiveStatus(record, now)
  const allowed = status === 'active' || (status === 'pending' && by !== 'patient')
  if (!allowed) {
    throw new ConsentError('invalid-transition', `${by} cannot withdraw a consent that is ${status}`)
  }
  return {
    ...record,
    version: record.version + 1,
    status: 'withdrawn',
    withdrawal: { at: now.toISOString(), by, ...(reason ? { reason } : {}) },
  }
}
