export interface ProviderSession {
  user: { userId: string; name: string; role: 'clinician' | 'provider-admin' }
  organisation: { odsCode: string; name: string; type: string; typeLabel: string; active: boolean }
  profile: { actions: string[]; htmlSections: string[]; clinicalAreas: string[] }
}

export interface PatientCard {
  nhsNumber: string
  restricted: boolean
  name?: string
  birthDate?: string | null
  age?: number | null
  gender?: string
  deceased?: boolean
  gp?: { odsCode: string; name: string } | null
  eligible: boolean
  ineligibleReasons: string[]
}

export interface ConsentSummary {
  id: string
  status: 'pending' | 'active' | 'declined' | 'withdrawn' | 'expired'
  nhsNumber: string
  patientName: string | null
  purpose: string
  requestedBy: string
  requestedAt: string
  requestExpiresAt: string
  decision: { outcome: string; at: string; via: 'nhs-login' | 'sms' } | null
  scope: { actions: string[]; htmlSections: string[]; clinicalAreas: string[] }
  htmlSections: Array<{ code: string; label: string }>
  clinicalAreas: Array<{ code: string; label: string }>
  validFrom: string | null
  expiresAt: string | null
  withdrawal: { at: string; by: string; reason?: string } | null
}

export interface PatientLookup {
  patient: PatientCard
  gpConnect: 'available' | 'not-enabled' | 'unknown'
  consents: ConsentSummary[]
}

export const REASON_TEXT: Record<string, string> = {
  'actor-inactive': 'Your account is not active.',
  'actor-role-not-permitted': 'Your role does not allow access to patient records.',
  'actor-not-in-organisation': 'You are not a member of the organisation that holds this consent.',
  'organisation-inactive': 'Your organisation is suspended from the service.',
  'patient-restricted': 'This patient has a restricted record and cannot be included in this service.',
  'patient-deceased': 'This patient has died.',
  'patient-under-16': 'This patient is under 16. Under-16s are not included in this service.',
  'patient-age-unknown': "This patient's date of birth is not known.",
  'no-consent': 'There is no consent for this patient.',
  'consent-patient-mismatch': 'This consent is for a different patient.',
  'consent-organisation-mismatch': 'This consent was given to a different organisation.',
  'consent-not-active': 'The patient has not agreed, or consent has been withdrawn or has expired.',
  'action-not-consented': 'The patient has not agreed to this kind of access.',
  'html-section-required': 'Choose a part of the record.',
  'html-section-not-consented': 'The patient has not agreed to you seeing this part of the record.',
  'clinical-areas-required': 'Choose which parts of the record you need.',
  'clinical-area-not-consented': 'The patient has not agreed to you seeing that part of the record.',
}
