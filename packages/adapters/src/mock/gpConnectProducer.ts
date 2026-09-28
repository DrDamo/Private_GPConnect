import type * as fhir3 from 'fhir/r3'
import { HTML_SECTIONS, type HtmlSection } from '@pgpc/core'
import { clinicalRecordFor, PATIENTS, PRACTICES, type SimPatient, type SimPractice } from '@pgpc/fixtures'
import { AdapterError } from '../errors'
import {
  decodeUnsignedJwt,
  GPC_NHS_NUMBER_SYSTEM,
  INTERACTION_GET_CARE_RECORD,
  RECORD_SECTION_SYSTEM,
  type GpConnectExchange,
  type GpConnectJwtClaims,
  type GpConnectTransport,
} from '../gpConnect'
import { renderSection, SECTION_TITLES } from './careRecordHtml'

// A simulated GP system (the GP Connect "producer"). It validates each request
// the way a real producer and the Spine Secure Proxy would, so mistakes in our
// JWT or headers fail here rather than on first contact with a real system.

const fail = (code: 'invalid-request' | 'unauthorised' | 'not-found', message: string): never => {
  throw new AdapterError('gp-connect', code, message)
}

function validate(ex: GpConnectExchange, practice: SimPractice, now: Date): { nhsNumber: string; section: HtmlSection } {
  const h = ex.headers
  if (h['Ssp-InteractionID'] !== INTERACTION_GET_CARE_RECORD) fail('invalid-request', 'Wrong Ssp-InteractionID')
  if (h['Ssp-To'] !== practice.asid) fail('invalid-request', 'Ssp-To does not match the practice ASID')
  if (!/^\d{12}$/.test(h['Ssp-From'] ?? '')) fail('invalid-request', 'Ssp-From must be a 12-digit ASID')
  if (!h['Ssp-TraceID']) fail('invalid-request', 'Ssp-TraceID is required')

  const token = h.Authorization?.replace(/^Bearer /, '') ?? ''
  const claims = decodeUnsignedJwt<GpConnectJwtClaims>(token)
  if (!claims) return fail('unauthorised', 'Authorization must carry an unsigned GP Connect JWT')
  const nowS = Math.floor(now.getTime() / 1000)
  if (claims.aud !== ex.url) fail('unauthorised', 'JWT aud does not match the request URL')
  if (!(claims.exp > nowS) || claims.exp - claims.iat > 300) fail('unauthorised', 'JWT expired or lifetime over 5 minutes')
  if (claims.iat > nowS + 60) fail('unauthorised', 'JWT issued in the future')
  if (claims.reason_for_request !== 'directcare') fail('unauthorised', 'reason_for_request must be directcare')
  if (!claims.requesting_organization?.identifier?.[0]?.value) fail('unauthorised', 'requesting_organization needs an ODS code')
  if (!claims.requesting_practitioner?.identifier?.length) fail('unauthorised', 'requesting_practitioner needs an identifier')

  const params = ex.body.parameter ?? []
  const nhsParam = params.find(p => p.name === 'patientNHSNumber')?.valueIdentifier
  const sectionCode = params.find(p => p.name === 'recordSection')?.valueCodeableConcept?.coding?.[0]
  if (nhsParam?.system !== GPC_NHS_NUMBER_SYSTEM || !nhsParam.value) fail('invalid-request', 'patientNHSNumber is required')
  if (sectionCode?.system !== RECORD_SECTION_SYSTEM || !HTML_SECTIONS.includes(sectionCode.code as HtmlSection)) {
    fail('invalid-request', 'recordSection is invalid')
  }
  const recordNhs = claims.requested_record?.identifier?.[0]?.value
  if (recordNhs !== nhsParam!.value) fail('unauthorised', 'JWT requested_record does not match patientNHSNumber')
  return { nhsNumber: nhsParam!.value!, section: sectionCode!.code as HtmlSection }
}

function renderBundle(patient: SimPatient, practice: SimPractice, section: HtmlSection, now: Date): fhir3.Bundle {
  const html = renderSection(section, patient, clinicalRecordFor(patient.recordProfile))
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: [
      {
        resource: {
          resourceType: 'Composition',
          date: now.toISOString(),
          status: 'final',
          type: { coding: [{ system: 'http://snomed.info/sct', code: '425173008', display: 'record extract (record artifact)' }] },
          title: 'Patient Care Record',
          subject: { reference: `Patient/${patient.nhsNumber}` },
          author: [{ reference: `Organization/${practice.odsCode}` }],
          section: [
            {
              title: SECTION_TITLES[section],
              code: { coding: [{ system: RECORD_SECTION_SYSTEM, code: section, display: SECTION_TITLES[section] }] },
              text: { status: 'generated', div: html },
            },
          ],
        } as fhir3.Composition,
      },
      {
        resource: {
          resourceType: 'Organization',
          id: practice.odsCode,
          identifier: [{ value: practice.odsCode }],
          name: practice.name,
        } as fhir3.Organization,
      },
    ],
  }
}

export function simulatedGpSystems(
  options: { patients?: SimPatient[]; practices?: SimPractice[]; clock?: () => Date } = {},
): GpConnectTransport {
  const patients = options.patients ?? PATIENTS
  const practices = options.practices ?? PRACTICES
  const clock = options.clock ?? (() => new Date())

  return async exchange => {
    const host = new URL(exchange.url).hostname
    const practice = practices.find(p => host === `${p.odsCode.toLowerCase()}.gpconnect.sim.invalid`)
    if (!practice || !practice.gpConnectEnabled) throw new AdapterError('gp-connect', 'unavailable', 'No GP Connect service at this address')
    const now = clock()
    const { nhsNumber, section } = validate(exchange, practice, now)
    const patient = patients.find(p => p.nhsNumber === nhsNumber && p.gpOdsCode === practice.odsCode)
    if (!patient) throw new AdapterError('gp-connect', 'not-found', 'Patient not found at this practice')
    return renderBundle(patient, practice, section, now)
  }
}
