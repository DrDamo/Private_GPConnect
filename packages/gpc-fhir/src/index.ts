// Public surface of the GP Connect FHIR package. Modules under ./fhir and
// ./builder are copied from GP-Connect-Demo (see PROVENANCE.md) and kept as
// close to upstream as possible so they can be re-synced.

export * from './fhir/types'
export { parseBundle, normalizePastedJson } from './fhir/parser'
export type { ParseResult } from './fhir/parser'
export { validateBundle, cleanDanglingRefs } from './fhir/validator'
export { isValidNhsNumber, nhsNumberCheckDigit } from './fhir/nhsNumber'
export { extractPatientInfo, formatDate, hasNopatSecurity } from './fhir/utils'

export { extractAllergies } from './fhir/allergies'
export { extractCodedData } from './fhir/codedData'
export { extractConsultations } from './fhir/consultations'
export { extractDiaryEntries } from './fhir/diaryEntries'
export { extractDocuments } from './fhir/documents'
export { extractImmunisations } from './fhir/immunisations'
export { extractInvestigations } from './fhir/investigations'
export { extractLists } from './fhir/lists'
export { extractMedications } from './fhir/medications'
export { extractProblems } from './fhir/problems'
export { extractReferrals } from './fhir/referrals'
export {
  extractPractitioners,
  extractPractitionerRoles,
  extractOrganisations,
  extractHealthcareServices,
  extractFhirMedications,
  extractLocations,
} from './fhir/supportingResources'

export { buildBundle } from './builder/generate'
export { createSampleDraft, createFullSampleDraft } from './builder/sampleData'
export type * from './builder/types'
