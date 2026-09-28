import type { ClinicalArea, ConsentAction, HtmlSection, ProviderType } from './types'

// Plain-English labels for what patients see. Keep them short, concrete and
// free of jargon (no "HTML", "structured", "FHIR").

export const ACTION_LABELS: Record<ConsentAction, string> = {
  'html.view': 'Look at parts of your GP record',
  'structured.retrieve': 'Copy parts of your GP record into their own records',
  'document.send': 'Send your GP practice details of any care or medicine they give you',
}

export const HTML_SECTION_LABELS: Record<HtmlSection, string> = {
  SUM: 'Summary',
  ENC: 'Consultations',
  CLI: 'Clinical items',
  PRB: 'Problems and conditions',
  ALL: 'Allergies',
  MED: 'Medicines',
  REF: 'Referrals',
  OBS: 'Test results and measurements',
  IMM: 'Vaccinations',
  ADM: 'Administrative items',
}

export const CLINICAL_AREA_LABELS: Record<ClinicalArea, string> = {
  allergies: 'Allergies',
  medications: 'Medicines',
  problems: 'Problems and conditions',
  consultations: 'Consultations',
  immunisations: 'Vaccinations',
  uncategorised: 'Measurements such as weight, BMI and blood pressure',
  investigations: 'Test results',
  referrals: 'Referrals',
  diary: 'Planned care and reminders',
}

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  pharmacy: 'Pharmacy',
  'weight-management': 'Weight management service',
  'medical-cannabis': 'Medical cannabis clinic',
}
