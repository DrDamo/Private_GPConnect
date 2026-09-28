import type * as fhir4 from 'fhir/r4'
import { isValidNhsNumber, normaliseNhsNumber } from '@pgpc/core'
import { PATIENTS, type SimPatient } from '@pgpc/fixtures'
import { AdapterError } from '../errors'
import {
  CONFIDENTIALITY_SYSTEM,
  NHS_NUMBER_SYSTEM,
  ODS_SYSTEM,
  pdsPatientFromFhir,
  type PdsAdapter,
  type PdsPatient,
  type PdsSearchQuery,
} from '../pds'

/**
 * Renders a synthetic patient as PDS FHIR would return it. Restricted (S-flag)
 * records have address, telecom and GP removed, as PDS does.
 */
export function toPdsFhirPatient(p: SimPatient): fhir4.Patient {
  const restricted = p.confidentiality !== 'U'
  return {
    resourceType: 'Patient',
    id: p.nhsNumber,
    meta: {
      versionId: '1',
      security: [
        {
          system: CONFIDENTIALITY_SYSTEM,
          code: p.confidentiality,
          display: restricted ? 'restricted' : 'unrestricted',
        },
      ],
    },
    identifier: [{ system: NHS_NUMBER_SYSTEM, value: p.nhsNumber }],
    name: [{ use: 'usual', family: p.name.family, given: p.name.given, ...(p.name.prefix ? { prefix: [p.name.prefix] } : {}) }],
    gender: p.gender,
    birthDate: p.birthDate,
    ...(p.deceasedDateTime ? { deceasedDateTime: p.deceasedDateTime } : {}),
    ...(!restricted && p.address
      ? { address: [{ use: 'home', line: p.address.line, city: p.address.city, postalCode: p.address.postalCode }] }
      : {}),
    ...(!restricted && p.mobile ? { telecom: [{ system: 'phone', use: 'mobile', value: p.mobile }] } : {}),
    ...(!restricted
      ? {
          generalPractitioner: [
            {
              type: 'Organization',
              identifier: { system: ODS_SYSTEM, value: p.gpOdsCode, period: { start: p.gpRegisteredSince } },
            },
          ],
        }
      : {}),
  }
}

const norm = (s: string) => s.trim().toLowerCase()
const normPostcode = (s: string) => s.replace(/\s/g, '').toUpperCase()

export class MockPds implements PdsAdapter {
  private readonly patients: SimPatient[]
  constructor(patients: SimPatient[] = PATIENTS) {
    this.patients = patients
  }

  async getPatient(nhsNumber: string): Promise<PdsPatient> {
    const n = normaliseNhsNumber(nhsNumber)
    if (!isValidNhsNumber(n)) throw new AdapterError('pds', 'invalid-request', 'Invalid NHS number')
    const p = this.patients.find(x => x.nhsNumber === n)
    if (!p) throw new AdapterError('pds', 'not-found', 'Patient not found')
    return pdsPatientFromFhir(toPdsFhirPatient(p))
  }

  async search(q: PdsSearchQuery): Promise<PdsPatient | null> {
    if (!q.family.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(q.birthDate)) {
      throw new AdapterError('pds', 'invalid-request', 'Family name and birth date (YYYY-MM-DD) are required')
    }
    const matches = this.patients.filter(
      p =>
        norm(p.name.family) === norm(q.family) &&
        p.birthDate === q.birthDate &&
        (!q.given || p.name.given.some(g => norm(g).startsWith(norm(q.given!)))) &&
        (!q.gender || p.gender === q.gender) &&
        // A restricted record's postcode is not searchable (PDS withholds it).
        (!q.postalCode || (p.address && normPostcode(p.address.postalCode) === normPostcode(q.postalCode))),
    )
    if (matches.length > 1) throw new AdapterError('pds', 'too-many-matches', 'More than one patient matches')
    return matches[0] ? pdsPatientFromFhir(toPdsFhirPatient(matches[0])) : null
  }
}
