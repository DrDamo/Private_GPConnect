import { effectiveStatus, type ConsentRecord } from './consent'
import type { ClinicalArea, ConsentAction, HtmlSection, ProviderType, UserRole } from './types'

// Policy decision point: the single check every call to a national service
// must pass (PLAN.md §4.1). It is a pure function over everything it needs, so
// callers cannot "forget" a check by not loading something — and every reason
// for denial is returned, not just the first, so the audit trail is complete.

export interface AccessRequest {
  action: ConsentAction
  actor: { userId: string; role: UserRole; active: boolean; organisationOdsCode: string }
  organisation: { odsCode: string; type: ProviderType; active: boolean }
  patient: { nhsNumber: string; restricted: boolean; deceased: boolean; birthDate?: string }
  consent: ConsentRecord | null
  /** Required for html.view. */
  htmlSection?: HtmlSection
  /** Required (non-empty) for structured.retrieve. */
  clinicalAreas?: ClinicalArea[]
  now: Date
}

export const DENY_REASONS = [
  'actor-inactive',
  'actor-role-not-permitted',
  'actor-not-in-organisation',
  'organisation-inactive',
  'patient-restricted',
  'patient-deceased',
  'patient-under-16',
  'patient-age-unknown',
  'no-consent',
  'consent-patient-mismatch',
  'consent-organisation-mismatch',
  'consent-not-active',
  'action-not-consented',
  'html-section-required',
  'html-section-not-consented',
  'clinical-areas-required',
  'clinical-area-not-consented',
] as const
export type DenyReason = (typeof DENY_REASONS)[number]

export type AccessDecision =
  | { decision: 'permit'; reasons: [] }
  | { decision: 'deny'; reasons: DenyReason[] }

/** Roles allowed to see or send clinical data. Provider admins manage users only. */
const CLINICAL_ROLES: readonly UserRole[] = ['clinician']

/** Minimum age for the MVP (PLAN.md §2.6: under-16s and proxies are out of scope). */
export const MIN_PATIENT_AGE = 16

export function ageOn(birthDate: string, now: Date): number {
  const b = new Date(`${birthDate}T00:00:00Z`)
  let age = now.getUTCFullYear() - b.getUTCFullYear()
  const beforeBirthday =
    now.getUTCMonth() < b.getUTCMonth() ||
    (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())
  if (beforeBirthday) age--
  return age
}

export function decide(req: AccessRequest): AccessDecision {
  const reasons: DenyReason[] = []
  const deny = (r: DenyReason) => reasons.push(r)

  // Who is asking
  if (!req.actor.active) deny('actor-inactive')
  if (!CLINICAL_ROLES.includes(req.actor.role)) deny('actor-role-not-permitted')
  if (req.actor.organisationOdsCode !== req.organisation.odsCode) deny('actor-not-in-organisation')
  if (!req.organisation.active) deny('organisation-inactive')

  // About whom
  if (req.patient.restricted) deny('patient-restricted')
  if (req.patient.deceased) deny('patient-deceased')
  if (!req.patient.birthDate) deny('patient-age-unknown')
  else if (ageOn(req.patient.birthDate, req.now) < MIN_PATIENT_AGE) deny('patient-under-16')

  // What for
  if (req.action === 'html.view' && !req.htmlSection) deny('html-section-required')
  if (req.action === 'structured.retrieve' && !req.clinicalAreas?.length) deny('clinical-areas-required')

  // With what permission
  const consent = req.consent
  if (!consent) {
    deny('no-consent')
  } else {
    if (consent.patient.nhsNumber !== req.patient.nhsNumber) deny('consent-patient-mismatch')
    if (consent.provider.odsCode !== req.organisation.odsCode) deny('consent-organisation-mismatch')
    if (effectiveStatus(consent, req.now) !== 'active') deny('consent-not-active')
    if (!consent.scope.actions.includes(req.action)) {
      deny('action-not-consented')
    } else {
      if (
        req.action === 'html.view' &&
        req.htmlSection &&
        !consent.scope.htmlSections.includes(req.htmlSection)
      ) {
        deny('html-section-not-consented')
      }
      if (
        req.action === 'structured.retrieve' &&
        req.clinicalAreas?.some(a => !consent.scope.clinicalAreas.includes(a))
      ) {
        deny('clinical-area-not-consented')
      }
    }
  }

  return reasons.length === 0 ? { decision: 'permit', reasons: [] } : { decision: 'deny', reasons }
}
