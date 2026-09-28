import type { AssuranceLevel, ConsentAction, ConsentScope, ProviderType } from './types'

// Data-minimisation profiles (PLAN.md §4.4). A provider can only ever ask for
// what its type's profile allows; the patient sees exactly this on the consent
// screen. Contents are illustrative until agreed with the Clinical Safety Officer.

export interface ProviderProfile {
  type: ProviderType
  label: string
  scope: ConsentScope
  /** Provider must notify the GP (Send Document) after prescribing/supplying. */
  sendDocumentRequired: boolean
  defaultDurationDays: number
  maxDurationDays: number
}

export const PROVIDER_PROFILES: Record<ProviderType, ProviderProfile> = {
  pharmacy: {
    type: 'pharmacy',
    label: 'Private pharmacy',
    scope: {
      actions: ['html.view', 'structured.retrieve', 'document.send'],
      htmlSections: ['SUM', 'MED', 'ALL'],
      clinicalAreas: ['medications', 'allergies'],
    },
    sendDocumentRequired: true,
    defaultDurationDays: 90,
    maxDurationDays: 180,
  },
  'weight-management': {
    type: 'weight-management',
    label: 'Weight management service',
    scope: {
      actions: ['html.view', 'structured.retrieve', 'document.send'],
      htmlSections: ['SUM', 'MED', 'ALL', 'PRB', 'OBS'],
      clinicalAreas: ['medications', 'allergies', 'problems', 'uncategorised'],
    },
    sendDocumentRequired: true,
    defaultDurationDays: 90,
    maxDurationDays: 180,
  },
  'medical-cannabis': {
    type: 'medical-cannabis',
    label: 'Medical cannabis clinic',
    scope: {
      actions: ['html.view', 'structured.retrieve', 'document.send'],
      htmlSections: ['SUM', 'MED', 'ALL', 'PRB', 'ENC'],
      clinicalAreas: ['medications', 'allergies', 'problems', 'consultations'],
    },
    sendDocumentRequired: true,
    defaultDurationDays: 90,
    maxDurationDays: 180,
  },
}

// What each identity-assurance route may authorise (PLAN.md §2.4). SMS proves
// control of a phone, not identity, so it is limited to view-only, short-lived
// consent.
export interface AssuranceRule {
  allowedActions: ConsentAction[]
  maxDurationDays: number
}

export const ASSURANCE_RULES: Record<AssuranceLevel, AssuranceRule> = {
  'nhs-login-p9': {
    allowedActions: ['html.view', 'structured.retrieve', 'document.send'],
    maxDurationDays: 180,
  },
  'sms-otp': {
    allowedActions: ['html.view'],
    maxDurationDays: 30,
  },
}

/** How long a patient has to respond before a pending request lapses. */
export const REQUEST_TTL_DAYS = 7
