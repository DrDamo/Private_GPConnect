// Domain vocabulary shared by consent, policy and audit.

export const PROVIDER_TYPES = ['pharmacy', 'weight-management', 'medical-cannabis'] as const
export type ProviderType = (typeof PROVIDER_TYPES)[number]

/** Things a provider can do with a patient's GP record. */
export const CONSENT_ACTIONS = ['html.view', 'structured.retrieve', 'document.send'] as const
export type ConsentAction = (typeof CONSENT_ACTIONS)[number]

/** GP Connect Access Record: HTML section codes. */
export const HTML_SECTIONS = ['SUM', 'ENC', 'CLI', 'PRB', 'ALL', 'MED', 'REF', 'OBS', 'IMM', 'ADM'] as const
export type HtmlSection = (typeof HTML_SECTIONS)[number]

/** GP Connect Access Record: Structured clinical areas. */
export const CLINICAL_AREAS = [
  'allergies',
  'medications',
  'problems',
  'consultations',
  'immunisations',
  'uncategorised',
  'investigations',
  'referrals',
  'diary',
] as const
export type ClinicalArea = (typeof CLINICAL_AREAS)[number]

/** How the patient proved who they were when giving consent. */
export const ASSURANCE_LEVELS = ['nhs-login-p9', 'sms-otp'] as const
export type AssuranceLevel = (typeof ASSURANCE_LEVELS)[number]

export const CONSENT_STATUSES = ['pending', 'active', 'declined', 'withdrawn', 'expired'] as const
export type ConsentStatus = (typeof CONSENT_STATUSES)[number]

export const USER_ROLES = ['clinician', 'provider-admin'] as const
export type UserRole = (typeof USER_ROLES)[number]

export interface ConsentScope {
  actions: ConsentAction[]
  htmlSections: HtmlSection[]
  clinicalAreas: ClinicalArea[]
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
