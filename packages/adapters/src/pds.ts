import type * as fhir4 from 'fhir/r4'
import { AdapterError } from './errors'

// Personal Demographics Service. The interface returns a domain model; the
// FHIR R4 Patient → model mapping (pdsPatientFromFhir) is shared by the
// simulator and the future real client, so it is exercised from day one.
// Ref: https://digital.nhs.uk/developer/api-catalogue/personal-demographics-service-fhir

export interface PdsPatient {
  nhsNumber: string
  /** R = restricted (S-flag): address, telecom and GP are withheld by PDS. */
  confidentiality: 'U' | 'R' | 'V' | 'REDACTED'
  restricted: boolean
  name: { prefix?: string; given: string[]; family: string } | null
  gender: 'female' | 'male' | 'other' | 'unknown'
  birthDate?: string
  deceased: boolean
  deceasedDateTime?: string
  address?: { line: string[]; city?: string; postalCode?: string }
  mobile?: string
  gp?: { odsCode: string; since?: string }
}

export interface PdsSearchQuery {
  family: string
  given?: string
  birthDate: string
  gender?: PdsPatient['gender']
  postalCode?: string
}

export interface PdsAdapter {
  /** Retrieve by NHS number. Throws AdapterError('not-found' | 'invalid-request'). */
  getPatient(nhsNumber: string): Promise<PdsPatient>
  /**
   * Application-restricted search: exact match returning at most one patient.
   * Throws AdapterError('too-many-matches') when ambiguous; returns null for no match.
   */
  search(query: PdsSearchQuery): Promise<PdsPatient | null>
}

export const NHS_NUMBER_SYSTEM = 'https://fhir.nhs.uk/Id/nhs-number'
export const ODS_SYSTEM = 'https://fhir.nhs.uk/Id/ods-organization-code'
export const CONFIDENTIALITY_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality'

export function pdsPatientFromFhir(resource: fhir4.Patient): PdsPatient {
  const nhsNumber = resource.identifier?.find(i => i.system === NHS_NUMBER_SYSTEM)?.value
  if (!nhsNumber) throw new AdapterError('pds', 'invalid-request', 'PDS Patient has no NHS number')

  const code = resource.meta?.security?.find(s => s.system === CONFIDENTIALITY_SYSTEM)?.code ?? 'U'
  const confidentiality = (['U', 'R', 'V', 'REDACTED'].includes(code) ? code : 'U') as PdsPatient['confidentiality']
  const name = resource.name?.find(n => n.use === 'usual') ?? resource.name?.[0]
  const address = resource.address?.find(a => a.use === 'home' && !a.period?.end) ?? resource.address?.[0]
  const mobile = resource.telecom?.find(t => t.system === 'phone' && t.use === 'mobile')?.value
  const gp = resource.generalPractitioner?.find(g => g.identifier?.system === ODS_SYSTEM)?.identifier

  return {
    nhsNumber,
    confidentiality,
    restricted: confidentiality !== 'U',
    name: name ? { prefix: name.prefix?.[0], given: name.given ?? [], family: name.family ?? '' } : null,
    gender: resource.gender ?? 'unknown',
    birthDate: resource.birthDate,
    deceased: Boolean(resource.deceasedDateTime || resource.deceasedBoolean),
    ...(resource.deceasedDateTime ? { deceasedDateTime: resource.deceasedDateTime } : {}),
    ...(address
      ? { address: { line: address.line ?? [], city: address.city, postalCode: address.postalCode } }
      : {}),
    ...(mobile ? { mobile } : {}),
    ...(gp?.value ? { gp: { odsCode: gp.value, since: gp.period?.start } } : {}),
  }
}

export function displayName(p: Pick<PdsPatient, 'name'>): string {
  if (!p.name) return '(name withheld)'
  return [p.name.prefix, ...p.name.given, p.name.family.toUpperCase()].filter(Boolean).join(' ')
}
