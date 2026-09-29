import type * as fhir3 from 'fhir/r3'
import { CLINICAL_AREAS, HTML_SECTIONS, type ClinicalArea, type HtmlSection } from '@pgpc/core'
import { clinicalRecordFor, PATIENTS, PRACTICES, type SimPatient, type SimPractice } from '@pgpc/fixtures'
import { AdapterError } from '../errors'
import {
  checkJwtClaims,
  decodeUnsignedJwt,
  ODS_CODE_SYSTEM,
  GPC_NHS_NUMBER_SYSTEM,
  INTERACTION_GET_CARE_RECORD,
  RECORD_SECTION_SYSTEM,
  type GpConnectExchange,
  type GpConnectJwtClaims,
  type GpConnectTransport,
} from '../gpConnect'
import { areaForParameter, INTERACTION_GET_STRUCTURED_RECORD, NHS_NUMBER_SYSTEM_1X } from '../gpConnectStructured'
import { renderSection, SECTION_TITLES } from './careRecordHtml'
import { structuredBundleFor } from './structuredRecord'

// A simulated GP system (the GP Connect "producer"). It validates each request
// the way a real producer and the Spine Secure Proxy would, so mistakes in our
// JWT or headers fail here rather than on first contact with a real system.

const fail = (code: 'invalid-request' | 'unauthorised' | 'not-found', message: string): never => {
  throw new AdapterError('gp-connect', code, message)
}

function validateCommon(ex: GpConnectExchange, practice: SimPractice, now: Date, interactionId: string): GpConnectJwtClaims {
  const h = ex.headers
  if (h['Ssp-InteractionID'] !== interactionId) fail('invalid-request', 'Wrong Ssp-InteractionID')
  if (h['Ssp-To'] !== practice.asid) fail('invalid-request', 'Ssp-To does not match the practice ASID')
  if (!/^\d{12}$/.test(h['Ssp-From'] ?? '')) fail('invalid-request', 'Ssp-From must be a 12-digit ASID')
  if (!h['Ssp-TraceID']) fail('invalid-request', 'Ssp-TraceID is required')

  const token = h.Authorization?.replace(/^Bearer /, '') ?? ''
  const claims = decodeUnsignedJwt<GpConnectJwtClaims>(token)
  if (!claims) return fail('unauthorised', 'Authorization must carry an unsigned GP Connect JWT')
  const version = interactionId === INTERACTION_GET_CARE_RECORD ? '0.7' : '1.x'
  const problems = checkJwtClaims(claims, { version, url: ex.url, now })
  if (problems.length) fail('unauthorised', problems.join('; '))
  return claims
}

function validateHtml(ex: GpConnectExchange, practice: SimPractice, now: Date): { nhsNumber: string; section: HtmlSection } {
  const claims = validateCommon(ex, practice, now, INTERACTION_GET_CARE_RECORD)
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

function validateStructured(ex: GpConnectExchange, practice: SimPractice, now: Date): { nhsNumber: string; areas: ClinicalArea[] } {
  const claims = validateCommon(ex, practice, now, INTERACTION_GET_STRUCTURED_RECORD)
  const params = ex.body.parameter ?? []
  const nhsParam = params.find(p => p.name === 'patientNHSNumber')?.valueIdentifier
  if (nhsParam?.system !== NHS_NUMBER_SYSTEM_1X || !nhsParam.value) fail('invalid-request', 'patientNHSNumber is required')
  const areas: ClinicalArea[] = []
  for (const p of params) {
    if (p.name === 'patientNHSNumber') continue
    const area = areaForParameter(p.name ?? '')
    if (!area || !CLINICAL_AREAS.includes(area)) fail('invalid-request', `Unknown parameter ${p.name}`)
    areas.push(area!)
  }
  if (areas.length === 0) fail('invalid-request', 'At least one clinical area must be requested')
  if (claims.requested_record?.identifier?.[0]?.value !== nhsParam!.value) {
    fail('unauthorised', 'JWT requested_record does not match patientNHSNumber')
  }
  return { nhsNumber: nhsParam!.value!, areas }
}

/** Shaped like a real 0.7.2 getcarerecord response (see fixtures/gpconnect-examples/html). */
function renderBundle(patient: SimPatient, practice: SimPractice, section: HtmlSection, now: Date): fhir3.Bundle {
  const html = renderSection(section, patient, clinicalRecordFor(patient.recordProfile))
  const patientId = patient.nhsNumber
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: [
      {
        resource: {
          resourceType: 'Composition',
          meta: { profile: ['http://fhir.nhs.net/StructureDefinition/gpconnect-carerecord-composition-1'] },
          date: now.toISOString(),
          type: {
            coding: [{ system: 'http://snomed.info/sct', code: '425173008', display: 'record extract (record artifact)' }],
            text: 'record extract (record artifact)',
          },
          class: {
            coding: [{ system: 'http://snomed.info/sct', code: '700232004', display: 'general medical service (qualifier value)' }],
            text: 'general medical service (qualifier value)',
          },
          title: 'Patient Care Record',
          status: 'final',
          subject: { reference: `Patient/${patientId}` },
          author: [{ reference: 'Practitioner/1' }],
          section: [
            {
              title: SECTION_TITLES[section],
              code: {
                coding: [{ system: RECORD_SECTION_SYSTEM, code: section, display: SECTION_TITLES[section] }],
                text: SECTION_TITLES[section],
              },
              text: { status: 'generated', div: html },
            },
          ],
        } as unknown as fhir3.Composition,
      },
      {
        fullUrl: 'Practitioner/1',
        resource: {
          resourceType: 'Practitioner',
          id: '1',
          meta: { profile: ['http://fhir.nhs.net/StructureDefinition/gpconnect-practitioner-1'] },
          identifier: [{ system: 'http://fhir.nhs.net/Id/sds-user-id', value: 'SIM000000001' }],
          // DSTU2 HumanName
          name: { use: 'usual', family: ['Patel'], given: ['Asha'], prefix: ['Dr'] },
        } as unknown as fhir3.Practitioner,
      },
      {
        fullUrl: `Organization/${practice.odsCode}`,
        resource: {
          resourceType: 'Organization',
          id: practice.odsCode,
          meta: { profile: ['http://fhir.nhs.net/StructureDefinition/gpconnect-organization-1'] },
          identifier: [{ system: ODS_CODE_SYSTEM, value: practice.odsCode }],
          name: practice.name,
        } as fhir3.Organization,
      },
      {
        fullUrl: `Patient/${patientId}`,
        resource: {
          resourceType: 'Patient',
          id: patientId,
          meta: { profile: ['http://fhir.nhs.net/StructureDefinition/gpconnect-patient-1'] },
          identifier: [{ system: GPC_NHS_NUMBER_SYSTEM, value: patient.nhsNumber }],
          name: [{ use: 'usual', family: [patient.name.family], given: patient.name.given }],
          gender: patient.gender,
          birthDate: patient.birthDate,
          careProvider: [{ reference: 'Practitioner/1' }],
        } as unknown as fhir3.Patient,
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
    const findPatient = (nhsNumber: string) => {
      const patient = patients.find(p => p.nhsNumber === nhsNumber && p.gpOdsCode === practice.odsCode)
      if (!patient) throw new AdapterError('gp-connect', 'not-found', 'Patient not found at this practice')
      return patient
    }
    if (exchange.headers['Ssp-InteractionID'] === INTERACTION_GET_STRUCTURED_RECORD) {
      const { nhsNumber, areas } = validateStructured(exchange, practice, now)
      return structuredBundleFor(findPatient(nhsNumber), practice, areas)
    }
    const { nhsNumber, section } = validateHtml(exchange, practice, now)
    return renderBundle(findPatient(nhsNumber), practice, section, now)
  }
}
