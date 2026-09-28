// ---------------------------------------------------------------------------
// generate/index.ts — assembles all domain generators into a single Bundle
// ---------------------------------------------------------------------------

import type { DraftRecord } from '../types'
import { TempIdMap } from '../idMap'
import { generateAdmin } from './admin'
import { generateMedications } from './medications'
import { generateAllergies } from './allergies'
import { generateProblems } from './problems'
import { generateConsultations } from './consultations'
import { generateImmunisations } from './immunisations'
import { generateInvestigations } from './investigations'
import { generateReferrals } from './referrals'
import { generateDiaryEntries } from './diaryEntries'
import { generateCodedData } from './codedData'
import { generateDocuments } from './documents'
import { generateDomainLists, generateSecondaryLists } from './lists'
import type { DomainEntries } from './lists'
import { excludeConfidential } from './security'

export function buildBundle(draft: DraftRecord): fhir3.Bundle {
  const idMap = new TempIdMap(draft)
  const patientRef = idMap.ref(draft.patient._tempId, 'Patient')

  // Allergies returns { activeEntries, endedListEntry } — handled separately
  const allergyResult = generateAllergies(draft, idMap, patientRef)

  // Build relatedClinicalContent map: problem _tempId → array of FHIR references
  const relatedContent = new Map<string, string[]>(
    draft.problems.map(p => [p._tempId, []])
  )

  function linkToProblems(
    items: Array<{ _tempId: string; linkedProblemTempIds?: string[]; confidential?: boolean }>,
    fhirType: string,
  ) {
    for (const item of items) {
      if (item.confidential) continue
      for (const probId of item.linkedProblemTempIds ?? []) {
        relatedContent.get(probId)?.push(idMap.ref(item._tempId, fhirType))
      }
    }
  }

  linkToProblems(draft.medications, 'MedicationStatement')
  linkToProblems(draft.allergies, 'AllergyIntolerance')
  linkToProblems(draft.consultations, 'Encounter')
  linkToProblems(draft.immunisations, 'Immunization')
  linkToProblems(draft.investigations, 'DiagnosticReport')
  linkToProblems(draft.referrals, 'ReferralRequest')
  linkToProblems(draft.diaryEntries, 'ProcedureRequest')
  linkToProblems(draft.codedData, 'Observation')
  linkToProblems(draft.documents, 'DocumentReference')
  // Problem-to-problem links: if Problem B links to Problem A, add B as relatedContent on A
  for (const p of draft.problems) {
    if (p.confidential) continue
    for (const probId of p.linkedProblemTempIds ?? []) {
      relatedContent.get(probId)?.push(idMap.ref(p._tempId, 'Condition'))
    }
  }

  // Build the reference lists for the 10 primary domain Lists — confidential
  // items are excluded here too (they were never generated as resources, so a
  // reference to one would dangle) and tracked below for the warning code.
  const domainEntries: DomainEntries = {
    medicationStatementRefs: excludeConfidential(draft.medications).map(m => idMap.ref(m._tempId, 'MedicationStatement')),
    activeAllergyRefs: excludeConfidential(draft.allergies)
      .filter(a => a.status !== 'resolved')
      .map(a => idMap.ref(a._tempId, 'AllergyIntolerance')),
    problemRefs: excludeConfidential(draft.problems).map(p => idMap.ref(p._tempId, 'Condition')),
    encounterRefs: excludeConfidential(draft.consultations).map(c => idMap.ref(c._tempId, 'Encounter')),
    immunisationRefs: excludeConfidential(draft.immunisations).map(i => idMap.ref(i._tempId, 'Immunization')),
    diagnosticReportRefs: excludeConfidential(draft.investigations).map(i => idMap.ref(i._tempId, 'DiagnosticReport')),
    referralRefs: excludeConfidential(draft.referrals).map(r => idMap.ref(r._tempId, 'ReferralRequest')),
    diaryEntryRefs: excludeConfidential(draft.diaryEntries).map(d => idMap.ref(d._tempId, 'ProcedureRequest')),
    codedDataRefs: excludeConfidential(draft.codedData).map(c => idMap.ref(c._tempId, 'Observation')),
    documentRefs: excludeConfidential(draft.documents).map(d => idMap.ref(d._tempId, 'DocumentReference')),
  }

  // Which domains had at least one confidential item withheld — drives the
  // "confidential-items" List warning code (see lists.ts).
  const confidentialDomains: Record<string, boolean> = {
    medications: draft.medications.some(m => m.confidential),
    allergies: draft.allergies.some(a => a.confidential),
    problems: draft.problems.some(p => p.confidential),
    consultations: draft.consultations.some(c => c.confidential),
    immunisations: draft.immunisations.some(i => i.confidential),
    investigations: draft.investigations.some(i => i.confidential),
    referrals: draft.referrals.some(r => r.confidential),
    diaryEntries: draft.diaryEntries.some(d => d.confidential),
    codedData: draft.codedData.some(c => c.confidential),
    documents: draft.documents.some(d => d.confidential),
  }

  const entries: fhir3.BundleEntry[] = [
    ...generateAdmin(draft, idMap),
    ...generateMedications(draft, idMap, patientRef),
    ...allergyResult.activeEntries,
    ...generateProblems(draft, idMap, patientRef, relatedContent),
    ...generateConsultations(draft, idMap, patientRef),
    ...generateImmunisations(draft, idMap, patientRef),
    ...generateInvestigations(draft, idMap, patientRef),
    ...generateReferrals(draft, idMap, patientRef),
    ...generateDiaryEntries(draft, idMap, patientRef),
    ...generateCodedData(draft, idMap, patientRef),
    ...generateDocuments(draft, idMap, patientRef),
    ...(allergyResult.endedListEntry ? [allergyResult.endedListEntry] : []),
    ...generateDomainLists(patientRef, domainEntries, confidentialDomains),
    ...generateSecondaryLists(draft, idMap, patientRef),
  ]

  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: entries,
  }
}
