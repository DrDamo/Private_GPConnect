import type * as fhir3 from 'fhir/r3'
import type { ClinicalArea } from '@pgpc/core'
import { clinicalRecordFor, type SimPatient, type SimPractice } from '@pgpc/fixtures'
import { buildBundle, type DraftRecord } from '@pgpc/gpc-fhir'
import { AREA_LIST_CODES } from '../gpConnectStructured'

// Builds a GP Connect Structured (STU3) bundle for a synthetic patient using
// the GP Connect Demonstrator's record builder, containing only the requested
// clinical areas, as a real producer would.

const quantity = (text: string) => {
  const m = /^(\d+)\s+(.*)$/.exec(text)
  return m ? { value: Number(m[1]), unit: m[2].replace(/s$/, '') } : { value: undefined, unit: text }
}

export function toDraftRecord(patient: SimPatient, practice: SimPractice): DraftRecord {
  const rec = clinicalRecordFor(patient.recordProfile)
  const gp = 'prac-gp'
  const nurse = 'prac-nurse'
  return {
    patient: {
      _tempId: 'patient-1',
      nhsNumber: patient.nhsNumber,
      nhsNumberVerified: true,
      prefix: patient.name.prefix,
      givenName: patient.name.given.join(' '),
      familyName: patient.name.family,
      dateOfBirth: patient.birthDate,
      gender: patient.gender,
      isActive: true,
      registrationType: 'Regular',
      registrationStart: patient.gpRegisteredSince,
      ...(patient.address ? { address: [...patient.address.line, patient.address.city, patient.address.postalCode].join(', ') } : {}),
      registeredGpTempId: gp,
    },
    organisation: { _tempId: 'org-1', name: practice.name, odsCode: practice.odsCode, address: practice.address },
    organisations: [],
    practitioners: [
      { _tempId: gp, prefix: 'Dr', givenName: 'Asha', familyName: 'Patel', role: 'General Practitioner', sdsUserId: 'SIM000000001' },
      { _tempId: nurse, givenName: 'Ben', familyName: 'Jones', role: 'Practice Nurse', sdsUserId: 'SIM000000002' },
    ],
    locations: [{ _tempId: 'loc-1', name: `${practice.name} — Main Building`, address: practice.address }],
    problems: rec.problems.map((p, i) => ({
      _tempId: `prob-${i}`,
      problem: p.term,
      snomedCode: p.snomed,
      clinicalStatus: p.status === 'active' ? 'active' : 'resolved',
      significance: p.significance,
      startDate: p.onset,
      endDate: p.ended,
      assertedDate: p.onset,
      asserterTempId: gp,
      confidential: p.confidential,
    })),
    medications: rec.medications.map((m, i) => {
      const q = quantity(m.quantity)
      return {
        _tempId: `med-${i}`,
        drugName: m.name,
        prescriptionType: m.type === 'Repeat' ? 'repeat' : 'acute',
        status: 'active',
        // The original free-text dosage instruction is always carried (it is
        // the clinical safety net for any later structured-dose translation).
        dosageInstruction: m.dosage,
        prescribedQuantityValue: q.value,
        prescribedQuantityUnit: q.unit,
        startDate: m.started,
        prescriberTempId: gp,
        recorderTempId: gp,
        issues: [
          {
            _tempId: `med-${i}-issue-1`,
            issueDate: m.lastIssued,
            startDate: m.lastIssued,
            quantityValue: q.value,
            quantityUnit: q.unit,
            dosageInstruction: m.dosage,
            recorderTempId: gp,
          },
        ],
      }
    }),
    allergies:
      rec.allergies === 'no-known-allergies'
        ? [
            {
              // Positively asserted "No known allergy" (SNOMED 716186003), as GP
              // systems record it; distinct from nothing recorded.
              _tempId: 'allergy-nka',
              causativeAgent: 'No known allergy',
              snomedCode: '716186003',
              category: 'medication',
              status: 'active',
              assertedDate: patient.gpRegisteredSince,
              recorderTempId: gp,
            },
          ]
        : rec.allergies.map((a, i) => ({
            _tempId: `allergy-${i}`,
            causativeAgent: a.substance,
            snomedCode: a.snomed,
            category: 'medication' as const,
            criticality: 'high' as const,
            reactionDescription: a.reaction,
            status: a.ended ? ('resolved' as const) : ('active' as const),
            ...(a.ended ? { endDate: a.ended, endReason: 'No longer applicable' } : {}),
            assertedDate: a.recorded,
            onsetDate: a.recorded,
            recorderTempId: gp,
          })),
    codedData: rec.observations.flatMap((o, i) => {
      const base = { date: o.date, status: 'final', performerTempId: nurse }
      // Blood pressure is two observations. Never pass "138/86" with a unit:
      // the builder would parseFloat it to 138 (a silent, unsafe truncation).
      const bp = /^(\d+)\/(\d+)\s*mmHg$/.exec(o.value)
      if (bp) {
        return [
          { ...base, _tempId: `obs-${i}-sys`, description: 'Systolic blood pressure', snomedCode: '271649006', value: bp[1], unit: 'mmHg' },
          { ...base, _tempId: `obs-${i}-dia`, description: 'Diastolic blood pressure', snomedCode: '271650006', value: bp[2], unit: 'mmHg' },
        ]
      }
      const numeric = /^(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(o.value)
      return [
        numeric && numeric[2]
          ? { ...base, _tempId: `obs-${i}`, description: o.name, snomedCode: o.snomed, value: numeric[1], unit: numeric[2] }
          : { ...base, _tempId: `obs-${i}`, description: o.name, snomedCode: o.snomed, value: o.value },
      ]
    }),
    consultations: rec.encounters.map((e, i) => ({
      _tempId: `cons-${i}`,
      date: e.date,
      typeDisplay: e.type,
      clinicianTempId: gp,
      orgTempId: 'org-1',
      confidential: e.confidential,
      topics: [
        {
          _tempId: `cons-${i}-topic`,
          title: e.type,
          categories: [],
          items: [{ _tempId: `cons-${i}-note`, itemType: 'note' as const, date: e.date, narrativeText: e.summary }],
        },
      ],
    })),
    immunisations: rec.immunisations.map((im, i) => ({
      _tempId: `imm-${i}`,
      vaccineName: im.vaccine,
      dateGiven: im.date,
      dateRecorded: im.date,
      status: 'completed',
      administeringPractitionerTempId: nurse,
    })),
    referrals: [],
    investigations: [],
    diaryEntries: [],
    documents: [],
  }
}

const DRAFT_KEYS: Record<ClinicalArea, keyof DraftRecord | null> = {
  allergies: 'allergies',
  medications: 'medications',
  problems: 'problems',
  consultations: 'consultations',
  immunisations: 'immunisations',
  uncategorised: 'codedData',
  investigations: 'investigations',
  referrals: 'referrals',
  diary: 'diaryEntries',
}

const ALL_LIST_CODES = new Set(Object.values(AREA_LIST_CODES).flat())
const DOCUMENTS_LIST = '823701000000100'

export function structuredBundleFor(patient: SimPatient, practice: SimPractice, areas: ClinicalArea[]): fhir3.Bundle {
  const draft = toDraftRecord(patient, practice)
  for (const [area, key] of Object.entries(DRAFT_KEYS) as Array<[ClinicalArea, keyof DraftRecord | null]>) {
    if (key && !areas.includes(area)) (draft[key] as unknown[]) = []
  }
  draft.documents = []
  const bundle = buildBundle(draft)
  const wantedCodes = new Set(areas.flatMap(a => AREA_LIST_CODES[a]))
  // The builder emits a List for every area; a producer returns Lists only for
  // what was requested.
  bundle.entry = (bundle.entry ?? []).filter(e => {
    if ((e.resource as fhir3.FhirResource | undefined)?.resourceType !== 'List') return true
    const code = (e.resource as fhir3.List).code?.coding?.[0]?.code ?? ''
    if (code === DOCUMENTS_LIST) return false
    return !ALL_LIST_CODES.has(code) || wantedCodes.has(code)
  })
  return bundle
}
