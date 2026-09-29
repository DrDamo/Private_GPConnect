import type * as fhir3 from 'fhir/r3'
import { describe, expect, it } from 'vitest'
import type { ClinicalArea } from '@pgpc/core'
import { MIDDLEWARE, PATIENTS, PRACTICES } from '@pgpc/fixtures'
import { extractAllergies, extractCodedData, extractConsultations, extractLists, extractMedications, extractProblems, validateBundle } from '@pgpc/gpc-fhir'
import {
  AdapterError,
  buildStructuredRecordRequest,
  GpConnectStructuredClient,
  MockSds,
  parseStructuredResponse,
  simulatedGpSystems,
  structuredBundleFor,
} from '../src'

const NOW = new Date('2026-10-01T09:00:00Z')
const requester = {
  user: { userId: 'sim-user-wm-doc', name: 'Dr Helen Carter', professionalRegistration: 'SIM-GMC-0002' },
  organisation: { odsCode: 'SIMWM1', name: 'Balance Weight Clinic (simulated)' },
}
const client = new GpConnectStructuredClient(simulatedGpSystems({ clock: () => NOW }), MIDDLEWARE, () => NOW)
const sds = new MockSds()

async function fetchRecord(nhsNumber: string, areas: ClinicalArea[]) {
  const patient = PATIENTS.find(p => p.nhsNumber === nhsNumber)!
  const endpoint = (await sds.getGpConnectEndpoint(patient.gpOdsCode))!
  return client.getStructuredRecord({ nhsNumber, areas, endpoint, requester, traceId: 't' })
}

const types = (b: fhir3.Bundle) => new Set<string>((b.entry ?? []).map(e => (e.resource as fhir3.FhirResource).resourceType))

describe('structured request', () => {
  it('asks only for the requested areas, with 1.x parameter names', async () => {
    const endpoint = (await sds.getGpConnectEndpoint('SIMGP1'))!
    const ex = buildStructuredRecordRequest({ nhsNumber: '9990000034', areas: ['medications', 'allergies', 'medications'], endpoint, requester, consumer: MIDDLEWARE, traceId: 't', now: NOW })
    expect(ex.headers['Ssp-InteractionID']).toBe('urn:nhs:names:services:gpconnect:fhir:operation:gpc.getstructuredrecord-1')
    expect(ex.url).toMatch(/\/Patient\/\$gpc\.getstructuredrecord$/)
    expect(ex.body.parameter?.map(p => p.name)).toEqual(['patientNHSNumber', 'includeMedication', 'includeAllergies'])
    expect(ex.body.parameter?.[0].valueIdentifier?.system).toBe('https://fhir.nhs.uk/Id/nhs-number')
  })
})

describe('structured record from the simulated GP system', () => {
  it('weight management profile: valid STU3, only the requested areas', async () => {
    const { record } = await fetchRecord('9990000034', ['medications', 'allergies', 'problems', 'uncategorised'])
    expect(validateBundle(record.bundle).issues.filter(i => i.severity === 'error')).toEqual([])
    expect(record.areas.sort()).toEqual(['allergies', 'medications', 'problems', 'uncategorised'])
    expect(record.removed).toEqual([])
    const t = types(record.bundle)
    expect(t.has('Encounter')).toBe(false)
    expect(t.has('Immunization')).toBe(false)
    expect(extractProblems(record.bundle).map(p => p.problem)).toContain('Anorexia nervosa')
  })

  it('pharmacy profile: no problems, observations or consultations at all', async () => {
    const { record } = await fetchRecord('9990000050', ['medications', 'allergies'])
    const t = types(record.bundle)
    for (const absent of ['Condition', 'Observation', 'Encounter', 'Immunization']) expect(t.has(absent)).toBe(false)
    expect(extractAllergies(record.bundle).map(a => a.causativeAgent)).toEqual(['Penicillin'])
  })

  it('keeps the original free-text dosage instruction on every medication', async () => {
    const { record } = await fetchRecord('9990000050', ['medications'])
    const meds = extractMedications(record.bundle)
    expect(meds.length).toBe(5)
    const warfarin = meds.find(m => m.drugName?.startsWith('Warfarin'))
    expect(warfarin?.dosageInstruction).toBe('As directed by the anticoagulant clinic')
    for (const m of meds) expect(m.dosageInstruction).toBeTruthy()
  })

  it('records "no known allergies" positively, not as an empty list', async () => {
    const { record } = await fetchRecord('9990000018', ['allergies'])
    const allergies = extractAllergies(record.bundle)
    expect(allergies).toHaveLength(1)
    expect(allergies[0]).toMatchObject({ snomedCode: '716186003' })
  })

  it('never truncates a blood pressure (138/86 is two observations, not 138)', async () => {
    const { record } = await fetchRecord('9990000034', ['uncategorised'])
    const obs = extractCodedData(record.bundle).map(o => [o.description, o.value, o.unit])
    expect(obs).toContainEqual(['Systolic blood pressure', expect.stringMatching(/^138/), 'mmHg'])
    expect(obs).toContainEqual(['Diastolic blood pressure', expect.stringMatching(/^86/), 'mmHg'])
    expect(obs.find(o => o[0] === 'Blood pressure')).toBeUndefined()
  })

  it('withholds confidential items and flags the List with a warning', async () => {
    const { record } = await fetchRecord('9990000123', ['problems', 'consultations'])
    expect(extractProblems(record.bundle).map(p => p.problem)).not.toContain('Termination of pregnancy')
    const problemsList = extractLists(record.bundle).find(l => l.title === 'Problems')
    expect(problemsList?.warningCode).toBe('confidential-items')
    expect(extractConsultations(record.bundle)).toHaveLength(2)
  })

  it('no allergies recorded: an empty List, distinct from a coded "no known allergy"', async () => {
    const { record } = await fetchRecord('9990000034', ['allergies'])
    expect(extractAllergies(record.bundle)).toEqual([])
    expect(extractLists(record.bundle).find(l => l.title?.startsWith('Allergies'))?.emptyReason).toBeTruthy()
  })

  it('an empty area comes back as an empty List, not missing', async () => {
    const { record } = await fetchRecord('9990000115', ['problems'])
    expect(record.areas).toEqual(['problems'])
    expect(extractLists(record.bundle).find(l => l.title === 'Problems')?.emptyReason).toBeTruthy()
  })

  it('refuses a request with no areas', async () => {
    await expect(fetchRecord('9990000018', [])).rejects.toBeInstanceOf(AdapterError)
  })
})

describe('parseStructuredResponse: defence in depth', () => {
  it('strips clinical content the producer returned but we did not ask for', () => {
    const patient = PATIENTS.find(p => p.nhsNumber === '9990000050')!
    const everything = structuredBundleFor(patient, PRACTICES[1], ['medications', 'allergies', 'problems', 'uncategorised', 'consultations', 'immunisations'])
    const { bundle, areas, removed } = parseStructuredResponse(everything, ['medications', 'allergies'])
    expect(areas.sort()).toEqual(['allergies', 'medications'])
    const t = types(bundle)
    for (const absent of ['Condition', 'Encounter', 'Immunization', 'Observation']) expect(t.has(absent)).toBe(false)
    expect(new Set(removed.map(r => r.area))).toEqual(new Set(['problems', 'uncategorised', 'consultations', 'immunisations']))
    expect(t.has('Patient') && t.has('Organization')).toBe(true)
  })

  it('rejects something that is not a Bundle', () => {
    expect(() => parseStructuredResponse({ resourceType: 'Patient' } as unknown as fhir3.Bundle, ['medications'])).toThrow(AdapterError)
  })
})
