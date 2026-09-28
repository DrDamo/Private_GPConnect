import type { DraftRecord } from '../types'
import type { TempIdMap } from '../idMap'

const LIST_CODES: Record<string, { code: string; display: string }> = {
  medications:    { code: '933361000000108', display: 'Medications and medical devices' },
  allergies:      { code: '886921000000105', display: 'Allergies and adverse reactions' },
  problems:       { code: '717711000000103', display: 'Problems' },
  consultations:  { code: '1149501000000101', display: 'List of consultations' },
  immunisations:  { code: '1102181000000102', display: 'Immunisations' },
  investigations: { code: '887191000000108', display: 'Investigations and results' },
  referrals:      { code: '792931000000107', display: 'Outbound referral' },
  diaryEntries:   { code: '714311000000108', display: 'Patient recall administration' },
  codedData:      { code: '826501000000100', display: 'Miscellaneous record' },
  documents:      { code: '823701000000100', display: 'Documents' },
}

const EMPTY_REASON_SYSTEM = 'https://fhir.nhs.uk/STU3/CodeSystem/CareConnect-ListEmptyReasonCode-1'
const LIST_PROFILE = 'https://fhir.nhs.uk/STU3/StructureDefinition/CareConnect-GPC-List-1'
const SECONDARY_LIST_SYSTEM = 'https://fhir.hl7.org.uk/STU3/CodeSystem/GPConnect-SecondaryListValues-1'
const ACTUAL_PROBLEM_EXT = 'https://fhir.nhs.uk/STU3/StructureDefinition/Extension-CareConnect-GPC-ActualProblem-1'
const WARNING_CODE_EXT = 'https://fhir.nhs.uk/STU3/StructureDefinition/Extension-CareConnect-GPC-ListWarningCode-1'

// https://simplifier.net/guide/gp-connect-access-record-structured/.../Warning-codes — the
// associated text MUST also be added to List.note whenever this code is used.
const CONFIDENTIAL_ITEMS_WARNING = {
  code: 'confidential-items',
  note: 'Items excluded due to confidentiality and/or patient preferences.',
}

export interface DomainEntries {
  medicationStatementRefs: string[]
  activeAllergyRefs: string[]
  problemRefs: string[]
  encounterRefs: string[]
  immunisationRefs: string[]
  diagnosticReportRefs: string[]
  referralRefs: string[]
  diaryEntryRefs: string[]
  codedDataRefs: string[]
  documentRefs: string[]
}

function makeDomainList(
  domain: string,
  patientRef: string,
  refs: string[],
  today: string,
  hasConfidentialExclusions: boolean,
): fhir3.BundleEntry {
  const listId = crypto.randomUUID()
  const { code, display } = LIST_CODES[domain]

  const list: fhir3.List = {
    resourceType: 'List',
    id: listId,
    meta: { profile: [LIST_PROFILE] },
    status: 'current',
    mode: 'snapshot',
    code: {
      coding: [{ system: 'http://snomed.info/sct', code, display }],
    },
    subject: { reference: patientRef },
    date: today,
    orderedBy: {
      coding: [{ system: 'http://hl7.org/fhir/list-order', code: 'event-date' }],
    },
    ...(refs.length > 0
      ? { entry: refs.map(ref => ({ item: { reference: ref } })) }
      : {
          emptyReason: {
            coding: [
              {
                system: EMPTY_REASON_SYSTEM,
                code: 'no-content-recorded',
                display: 'No content recorded',
              },
            ],
          },
        }),
    ...(hasConfidentialExclusions
      ? {
          extension: [{ url: WARNING_CODE_EXT, valueCode: CONFIDENTIAL_ITEMS_WARNING.code }],
          note: [{ text: CONFIDENTIAL_ITEMS_WARNING.note }],
        }
      : {}),
  }

  return { fullUrl: `urn:uuid:${listId}`, resource: list }
}

export function generateDomainLists(
  patientRef: string,
  entries: DomainEntries,
  confidentialDomains: Record<string, boolean> = {},
): fhir3.BundleEntry[] {
  const today = new Date().toISOString()
  const excl = (domain: string) => confidentialDomains[domain] ?? false

  return [
    makeDomainList('medications', patientRef, entries.medicationStatementRefs, today, excl('medications')),
    makeDomainList('allergies', patientRef, entries.activeAllergyRefs, today, excl('allergies')),
    makeDomainList('problems', patientRef, entries.problemRefs, today, excl('problems')),
    makeDomainList('consultations', patientRef, entries.encounterRefs, today, excl('consultations')),
    makeDomainList('immunisations', patientRef, entries.immunisationRefs, today, excl('immunisations')),
    makeDomainList('investigations', patientRef, entries.diagnosticReportRefs, today, excl('investigations')),
    makeDomainList('referrals', patientRef, entries.referralRefs, today, excl('referrals')),
    makeDomainList('diaryEntries', patientRef, entries.diaryEntryRefs, today, excl('diaryEntries')),
    makeDomainList('codedData', patientRef, entries.codedDataRefs, today, excl('codedData')),
    makeDomainList('documents', patientRef, entries.documentRefs, today, excl('documents')),
  ]
}

// ---------------------------------------------------------------------------
// Secondary lists
// ---------------------------------------------------------------------------

interface SecondaryListDef {
  code: string
  display: string
}

// Consultation-grouped secondary list codes
const CONSULTATION_SECONDARY: Record<string, SecondaryListDef> = {
  medications:    { code: 'consultations-medications-contained-in-consultations',    display: 'Medications contained in consultations' },
  allergies:      { code: 'consultations-allergies-contained-in-consultations',      display: 'Allergies and adverse reactions contained in consultations' },
  problems:       { code: 'consultations-problems-contained-in-consultations',       display: 'Problems contained in consultations' },
  immunisations:  { code: 'consultations-immunisations-contained-in-consultations',  display: 'Immunisations contained in consultations' },
  investigations: { code: 'consultations-investigations-contained-in-consultations', display: 'Investigations and results contained in consultations' },
  referrals:      { code: 'consultations-referrals-contained-in-consultations',      display: 'Referrals contained in consultations' },
  diaryEntries:   { code: 'consultations-diary-entries-contained-in-consultations',  display: 'Patient recall administration contained in consultations' },
  codedData:      { code: 'consultations-uncategorised-data-contained-in-consultations', display: 'Miscellaneous records contained in consultations' },
  documents:      { code: 'consultations-documents-contained-in-consultations',      display: 'Documents contained in consultations' },
}

// Problem-grouped secondary list codes
const PROBLEM_SECONDARY: Record<string, SecondaryListDef> = {
  medications:    { code: 'problems-medications-related-to-problems',    display: 'Medications related to problems' },
  allergies:      { code: 'problems-allergies-related-to-problems',      display: 'Allergies and adverse reactions related to problems' },
  immunisations:  { code: 'problems-immunisations-related-to-problems',  display: 'Immunisations related to problems' },
  investigations: { code: 'problems-investigations-related-to-problems', display: 'Investigations and results related to problems' },
  referrals:      { code: 'problems-referrals-related-to-problems',      display: 'Referrals related to problems' },
  diaryEntries:   { code: 'problems-diary-entries-related-to-problems',  display: 'Patient recall administration related to problems' },
  codedData:      { code: 'problems-uncategorised-data-related-to-problems', display: 'Miscellaneous records related to problems' },
  documents:      { code: 'problems-documents-related-to-problems',      display: 'Documents related to problems' },
  consultations:  { code: 'problems-consultations-related-to-problems',  display: 'List of consultations related to problems' },
  linkedProblems: { code: 'problems-linked-problems-not-relating-to-the-primary-query', display: 'Problems linked to problems' },
}

function makeSecondaryList(
  def: SecondaryListDef,
  refs: string[],
  patientRef: string,
  today: string,
  encounterRef?: string,
  problemRef?: string,
): fhir3.BundleEntry | null {
  if (refs.length === 0) return null

  const listId = crypto.randomUUID()

  const extensions: fhir3.Extension[] = []
  if (problemRef) {
    extensions.push({
      url: ACTUAL_PROBLEM_EXT,
      valueReference: { reference: problemRef },
    })
  }

  const list = {
    resourceType: 'List',
    id: listId,
    meta: { profile: [LIST_PROFILE] },
    status: 'current',
    mode: 'snapshot',
    code: {
      coding: [{ system: SECONDARY_LIST_SYSTEM, code: def.code, display: def.display }],
    },
    subject: { reference: patientRef },
    date: today,
    ...(extensions.length > 0 ? { extension: extensions } : {}),
    ...(encounterRef ? { encounter: { reference: encounterRef } } : {}),
    entry: refs.map(ref => ({ item: { reference: ref } })),
  } as unknown as fhir3.List

  return { fullUrl: `urn:uuid:${listId}`, resource: list }
}

export function generateSecondaryLists(
  draft: DraftRecord,
  map: TempIdMap,
  patientRef: string,
): fhir3.BundleEntry[] {
  const today = new Date().toISOString()
  const results: fhir3.BundleEntry[] = []

  // --- Consultation-grouped lists ---
  // For each consultation, find all items that list it as linkedConsultationTempId
  for (const cons of draft.consultations) {
    if (cons.confidential) continue
    const encRef = map.ref(cons._tempId, 'Encounter')

    const grouped: Record<string, string[]> = {
      medications:    draft.medications.filter(m => m.linkedConsultationTempId === cons._tempId && !m.confidential).map(m => map.ref(m._tempId, 'MedicationStatement')),
      allergies:      draft.allergies.filter(a => a.linkedConsultationTempId === cons._tempId && !a.confidential).map(a => map.ref(a._tempId, 'AllergyIntolerance')),
      problems:       draft.problems.filter(p => p.linkedConsultationTempId === cons._tempId && !p.confidential).map(p => map.ref(p._tempId, 'Condition')),
      immunisations:  draft.immunisations.filter(i => i.linkedConsultationTempId === cons._tempId && !i.confidential).map(i => map.ref(i._tempId, 'Immunization')),
      investigations: draft.investigations.filter(i => i.linkedConsultationTempId === cons._tempId && !i.confidential).map(i => map.ref(i._tempId, 'DiagnosticReport')),
      referrals:      draft.referrals.filter(r => r.linkedConsultationTempId === cons._tempId && !r.confidential).map(r => map.ref(r._tempId, 'ReferralRequest')),
      diaryEntries:   draft.diaryEntries.filter(d => d.linkedConsultationTempId === cons._tempId && !d.confidential).map(d => map.ref(d._tempId, 'ProcedureRequest')),
      codedData:      draft.codedData.filter(c => c.linkedConsultationTempId === cons._tempId && !c.confidential).map(c => map.ref(c._tempId, 'Observation')),
      documents:      draft.documents.filter(d => d.linkedConsultationTempId === cons._tempId && !d.confidential).map(d => map.ref(d._tempId, 'DocumentReference')),
    }

    for (const [domain, refs] of Object.entries(grouped)) {
      const def = CONSULTATION_SECONDARY[domain]
      const entry = makeSecondaryList(def, refs, patientRef, today, encRef, undefined)
      if (entry) results.push(entry)
    }
  }

  // --- Problem-grouped lists ---
  for (const prob of draft.problems) {
    if (prob.confidential) continue
    const probRef = map.ref(prob._tempId, 'Condition')

    const grouped: Record<string, string[]> = {
      medications:    draft.medications.filter(m => m.linkedProblemTempIds?.includes(prob._tempId) && !m.confidential).map(m => map.ref(m._tempId, 'MedicationStatement')),
      allergies:      draft.allergies.filter(a => a.linkedProblemTempIds?.includes(prob._tempId) && !a.confidential).map(a => map.ref(a._tempId, 'AllergyIntolerance')),
      immunisations:  draft.immunisations.filter(i => i.linkedProblemTempIds?.includes(prob._tempId) && !i.confidential).map(i => map.ref(i._tempId, 'Immunization')),
      investigations: draft.investigations.filter(i => i.linkedProblemTempIds?.includes(prob._tempId) && !i.confidential).map(i => map.ref(i._tempId, 'DiagnosticReport')),
      referrals:      draft.referrals.filter(r => r.linkedProblemTempIds?.includes(prob._tempId) && !r.confidential).map(r => map.ref(r._tempId, 'ReferralRequest')),
      diaryEntries:   draft.diaryEntries.filter(d => d.linkedProblemTempIds?.includes(prob._tempId) && !d.confidential).map(d => map.ref(d._tempId, 'ProcedureRequest')),
      codedData:      draft.codedData.filter(c => c.linkedProblemTempIds?.includes(prob._tempId) && !c.confidential).map(c => map.ref(c._tempId, 'Observation')),
      documents:      draft.documents.filter(d => d.linkedProblemTempIds?.includes(prob._tempId) && !d.confidential).map(d => map.ref(d._tempId, 'DocumentReference')),
      consultations:  draft.consultations.filter(c => c.linkedProblemTempIds?.includes(prob._tempId) && !c.confidential).map(c => map.ref(c._tempId, 'Encounter')),
      linkedProblems: draft.problems.filter(p => p._tempId !== prob._tempId && p.linkedProblemTempIds?.includes(prob._tempId) && !p.confidential).map(p => map.ref(p._tempId, 'Condition')),
    }

    for (const [domain, refs] of Object.entries(grouped)) {
      const def = PROBLEM_SECONDARY[domain]
      const entry = makeSecondaryList(def, refs, patientRef, today, undefined, probRef)
      if (entry) results.push(entry)
    }
  }

  return results
}
