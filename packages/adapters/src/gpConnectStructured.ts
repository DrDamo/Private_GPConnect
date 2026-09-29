import type * as fhir3 from 'fhir/r3'
import type { ClinicalArea } from '@pgpc/core'
import { AdapterError } from './errors'
import { buildJwtClaims, interpretGpConnectResponse, spineHeaders, type Consumer, type GpConnectExchange, type GpConnectTransport, type Requester } from './gpConnect'
import type { GpConnectEndpoint } from './sds'

// GP Connect Access Record: Structured ($gpc.getstructuredrecord, FHIR STU3).
//
// Only the clinical areas the patient consented to are requested; the
// response is then checked to contain nothing else (defence in depth), so data
// minimisation doesn't depend on the producer behaving.
//
// ⚠ Parameter names follow our reading of GP Connect Access Record Structured
// 1.x (https://developer.nhs.uk/apis/gpconnect-1-6-0/accessrecord_structured.html).
// `includeDiaryEntries` in particular is unconfirmed. Verify against the version
// in use before any real integration.

export const INTERACTION_GET_STRUCTURED_RECORD = 'urn:nhs:names:services:gpconnect:fhir:operation:gpc.getstructuredrecord-1'
export const NHS_NUMBER_SYSTEM_1X = 'https://fhir.nhs.uk/Id/nhs-number'

const AREA_PARAMETERS: Record<ClinicalArea, fhir3.ParametersParameter> = {
  allergies: { name: 'includeAllergies', part: [{ name: 'includeResolvedAllergies', valueBoolean: true }] },
  medications: { name: 'includeMedication', part: [{ name: 'includePrescriptionIssues', valueBoolean: true }] },
  problems: { name: 'includeProblems' },
  consultations: { name: 'includeConsultations', part: [{ name: 'includeNumberOfMostRecent', valueInteger: 3 }] },
  immunisations: { name: 'includeImmunisations' },
  uncategorised: { name: 'includeUncategorisedData' },
  investigations: { name: 'includeInvestigations' },
  referrals: { name: 'includeReferrals' },
  diary: { name: 'includeDiaryEntries' },
}

export const areaForParameter = (name: string): ClinicalArea | undefined =>
  (Object.entries(AREA_PARAMETERS) as Array<[ClinicalArea, fhir3.ParametersParameter]>).find(([, p]) => p.name === name)?.[0]

/** SNOMED codes of the primary GP Connect Lists for each clinical area. */
export const AREA_LIST_CODES: Record<ClinicalArea, string[]> = {
  medications: ['933361000000108'],
  allergies: ['886921000000105', '1103671000000101'],
  problems: ['717711000000103'],
  consultations: ['1149501000000101'],
  immunisations: ['1102181000000102'],
  investigations: ['887191000000108'],
  referrals: ['792931000000107'],
  diary: ['714311000000108'],
  uncategorised: ['826501000000100'],
}

/** Which clinical area a clinical resource type belongs to (supporting resources return undefined). */
export const AREA_FOR_RESOURCE: Partial<Record<string, ClinicalArea>> = {
  AllergyIntolerance: 'allergies',
  MedicationStatement: 'medications',
  MedicationRequest: 'medications',
  Medication: 'medications',
  Condition: 'problems',
  Encounter: 'consultations',
  Immunization: 'immunisations',
  DiagnosticReport: 'investigations',
  Specimen: 'investigations',
  ReferralRequest: 'referrals',
  ProcedureRequest: 'diary',
}

export function buildStructuredRecordRequest(input: {
  nhsNumber: string
  areas: ClinicalArea[]
  endpoint: GpConnectEndpoint
  requester: Requester
  consumer: Consumer
  traceId: string
  now?: Date
}): GpConnectExchange {
  const url = `${input.endpoint.address}/Patient/$gpc.getstructuredrecord`
  const claims = buildJwtClaims({ version: '1.x', url, nhsNumber: input.nhsNumber, nhsNumberSystem: NHS_NUMBER_SYSTEM_1X, requester: input.requester, now: input.now ?? new Date() })
  return {
    url,
    jwtClaims: claims,
    headers: spineHeaders({ traceId: input.traceId, consumer: input.consumer, endpoint: input.endpoint, interactionId: INTERACTION_GET_STRUCTURED_RECORD, claims }),
    body: {
      resourceType: 'Parameters',
      parameter: [
        { name: 'patientNHSNumber', valueIdentifier: { system: NHS_NUMBER_SYSTEM_1X, value: input.nhsNumber } },
        ...[...new Set(input.areas)].map(a => structuredClone(AREA_PARAMETERS[a])),
      ],
    },
  }
}

const SECONDARY_LIST_SYSTEM = 'https://fhir.hl7.org.uk/STU3/CodeSystem/GPConnect-SecondaryListValues-1'

/** Which area a List belongs to: primary area Lists by SNOMED code; consultation
 * structure Lists (topics/categories) by their encounter; secondary Lists by the
 * area that groups them ("consultations-…", "problems-…"). */
function listArea(list: fhir3.List): ClinicalArea | undefined {
  const snomed = list.code?.coding?.find(c => c.system === 'http://snomed.info/sct')?.code
  if (snomed) {
    const primary = (Object.entries(AREA_LIST_CODES) as Array<[ClinicalArea, string[]]>).find(([, codes]) => codes.includes(snomed))?.[0]
    if (primary) return primary
  }
  const secondary = list.code?.coding?.find(c => c.system === SECONDARY_LIST_SYSTEM)?.code
  if (secondary?.startsWith('consultations-')) return 'consultations'
  if (secondary?.startsWith('problems-')) return 'problems'
  if (list.encounter) return 'consultations'
  return undefined
}

const isPrimaryList = (list: fhir3.List) => {
  const snomed = list.code?.coding?.find(c => c.system === 'http://snomed.info/sct')?.code
  return Boolean(snomed && Object.values(AREA_LIST_CODES).some(codes => codes.includes(snomed)))
}

export interface StructuredRecord {
  bundle: fhir3.Bundle
  /** Areas the response actually contains (by primary List). */
  areas: ClinicalArea[]
  /** Anything outside the requested areas that was stripped out. */
  removed: { resourceType: string; area: ClinicalArea }[]
}

/**
 * Validates a structured response and removes any clinical content outside
 * the requested areas. Supporting resources (Patient, Practitioner,
 * Organization, Location, consultation-structure Lists, Observations
 * referenced from requested areas) are kept.
 */
export function parseStructuredResponse(bundle: fhir3.Bundle, requested: ClinicalArea[]): StructuredRecord {
  if (bundle?.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) {
    throw new AdapterError('gp-connect', 'invalid-request', 'Structured response is not a Bundle')
  }
  const removed: StructuredRecord['removed'] = []
  const present = new Set<ClinicalArea>()
  const keep = bundle.entry.filter(e => {
    const r = e.resource as fhir3.FhirResource | undefined
    if (!r) return false
    const area = r.resourceType === 'List' ? listArea(r as fhir3.List) : AREA_FOR_RESOURCE[r.resourceType]
    if (!area) return true
    if (!requested.includes(area)) {
      removed.push({ resourceType: r.resourceType, area })
      return false
    }
    if (r.resourceType === 'List' && isPrimaryList(r as fhir3.List)) present.add(area)
    return true
  })
  // Observations can belong to several areas (uncategorised data, test
  // results, consultation content). Without uncategorised data, keep only
  // those referenced by something we kept.
  let entries = keep
  if (!requested.includes('uncategorised')) {
    const referenced = JSON.stringify(keep.filter(e => (e.resource as fhir3.FhirResource | undefined)?.resourceType !== 'Observation').map(e => e.resource))
    entries = keep.filter(e => {
      const r = e.resource as fhir3.FhirResource
      if (r.resourceType !== 'Observation' || referenced.includes(`Observation/${r.id}`)) return true
      removed.push({ resourceType: 'Observation', area: 'uncategorised' })
      return false
    })
  }
  return { bundle: { ...bundle, entry: entries }, areas: [...present], removed }
}

export interface GpConnectStructuredAdapter {
  getStructuredRecord(input: {
    nhsNumber: string
    areas: ClinicalArea[]
    endpoint: GpConnectEndpoint
    requester: Requester
    traceId: string
  }): Promise<{ record: StructuredRecord; exchange: GpConnectExchange }>
}

export class GpConnectStructuredClient implements GpConnectStructuredAdapter {
  private readonly transport: GpConnectTransport
  private readonly consumer: Consumer
  private readonly clock: () => Date
  constructor(transport: GpConnectTransport, consumer: Consumer, clock: () => Date = () => new Date()) {
    this.transport = transport
    this.consumer = consumer
    this.clock = clock
  }

  async getStructuredRecord(input: Parameters<GpConnectStructuredAdapter['getStructuredRecord']>[0]) {
    if (input.areas.length === 0) throw new AdapterError('gp-connect', 'invalid-request', 'At least one clinical area is required')
    const exchange = buildStructuredRecordRequest({ ...input, consumer: this.consumer, now: this.clock() })
    const bundle = interpretGpConnectResponse(await this.transport(exchange))
    return { record: parseStructuredResponse(bundle, input.areas), exchange }
  }
}
