import type { ValidationIssue, ValidationResult } from './types'
import { isValidNhsNumber } from './nhsNumber'

type AnyResource = fhir3.Resource & { resourceType: string }

// All valid SNOMED codes for GP Connect List resources (14 total):
// 11 primary domain Lists + 3 consultation-structure Lists (per CareConnect-GPC-List-1 profile)
const GP_CONNECT_KNOWN_LIST_CODES = new Set([
  // Primary domain Lists
  '886921000000105',  // Allergies and adverse reactions
  '1103671000000101', // Ended allergies
  '1149501000000101', // List of consultations
  '714311000000108',  // Patient recall administration (diary entries)
  '1102181000000102', // Immunisations
  '887191000000108',  // Investigations and results
  '933361000000108',  // Medications and medical devices
  '792931000000107',  // Outbound referral
  '717711000000103',  // Problems
  '826501000000100',  // Miscellaneous record (uncategorised data)
  '823701000000100',  // Documents
  // Consultation-structure Lists (GP Connect structured consultation record)
  '325851000000107',  // Consultation (consultation wrapper List per Encounter)
  '25851000000105',   // Consultation topic (topic List within consultation)
  '24781000000107',   // Consultation category (category List within topic)
])

function buildReferenceIndex(bundle: fhir3.Bundle): Set<string> {
  const refs = new Set<string>()
  for (const entry of bundle.entry ?? []) {
    const r = entry.resource as AnyResource | undefined
    if (!r) continue
    if (entry.fullUrl) refs.add(entry.fullUrl)
    if (r.id) {
      refs.add(`${r.resourceType}/${r.id}`)
      refs.add(r.id)
    }
  }
  return refs
}

// Returns true if ref is absent, local ('#'), or found in the index
function resolves(ref: string | undefined, index: Set<string>): boolean {
  if (!ref) return true
  if (ref.startsWith('#')) return true
  return index.has(ref)
}

function countResources(bundle: fhir3.Bundle): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of bundle.entry ?? []) {
    const rt = (entry.resource as AnyResource | undefined)?.resourceType
    if (rt) counts[rt] = (counts[rt] ?? 0) + 1
  }
  return counts
}

function getEntries<T extends fhir3.Resource>(bundle: fhir3.Bundle, resourceType: string): T[] {
  return (bundle.entry ?? [])
    .map(e => e.resource as AnyResource | undefined)
    .filter((r): r is T & AnyResource => r?.resourceType === resourceType)
}

// Tracks every check that ran (regardless of outcome) so the UI can show
// "tests that passed" alongside the failures — one title per check, not one
// per resource it was run against. A title that never failed anywhere it
// applied counts as passed; a title used with a dynamic message needs an
// explicit stable title (see the `title` param on req()).
class CheckTracker {
  private seen = new Set<string>()
  private failed = new Set<string>()

  record(title: string, passed: boolean): void {
    this.seen.add(title)
    if (!passed) this.failed.add(title)
  }

  passedTitles(): string[] {
    return [...this.seen].filter(t => !this.failed.has(t)).sort()
  }
}

function req(
  tracker: CheckTracker,
  issues: ValidationIssue[],
  condition: boolean,
  severity: ValidationIssue['severity'],
  message: string,
  path: string,
  resourceId?: string,
  title?: string,
) {
  tracker.record(title ?? message, condition)
  if (!condition) issues.push({ severity, message, path, resourceId })
}

export function validateBundle(bundle: fhir3.Bundle): ValidationResult {
  const issues: ValidationIssue[] = []
  const resourceCounts = countResources(bundle)
  const tracker = new CheckTracker()

  if (bundle.resourceType !== 'Bundle') {
    issues.push({ severity: 'error', message: 'Root resource must be a Bundle', path: 'resourceType' })
    return { valid: false, issues, resourceCounts, passed: tracker.passedTitles() }
  }
  tracker.record('Root resource is a Bundle', true)

  const validBundleType = !bundle.type || ['collection', 'document', 'searchset'].includes(bundle.type)
  tracker.record('Bundle.type is a recognised value', validBundleType)
  if (!validBundleType) {
    issues.push({
      severity: 'warning',
      message: `Bundle.type is "${bundle.type}"; GP Connect typically uses "collection" or "document"`,
      path: 'Bundle.type',
    })
  }

  if (!bundle.entry || bundle.entry.length === 0) {
    issues.push({ severity: 'error', message: 'Bundle has no entries', path: 'Bundle.entry' })
    return { valid: false, issues, resourceCounts, passed: tracker.passedTitles() }
  }

  // Duplicate resource IDs — FHIR requires each resource in a bundle to have a unique id.
  // Duplicate ids cause reference resolution to return the wrong resource and FHIR source
  // links to navigate to the first occurrence regardless of type.
  const seenIds = new Set<string>()
  let hasDuplicateId = false
  for (const entry of bundle.entry) {
    const r = entry.resource as AnyResource | undefined
    if (!r?.id) continue
    const key = `${r.resourceType}/${r.id}`
    if (seenIds.has(key)) {
      hasDuplicateId = true
      issues.push({
        severity: 'error',
        message: `Duplicate resource ID "${r.id}" on ${r.resourceType} — IDs must be unique per resource type within a bundle. FHIR links for this resource will resolve to the first occurrence.`,
        path: key,
        resourceId: r.id,
      })
    }
    seenIds.add(key)
  }
  tracker.record('All resource IDs are unique within their resource type', !hasDuplicateId)

  // Patient
  const patients = getEntries<fhir3.Patient>(bundle, 'Patient')
  tracker.record('Exactly one Patient resource is present', patients.length === 1)
  if (patients.length === 0) {
    issues.push({ severity: 'warning', message: 'No Patient resource found in Bundle', path: 'Bundle.entry' })
  } else if (patients.length > 1) {
    issues.push({ severity: 'warning', message: 'Multiple Patient resources found — expected exactly one', path: 'Bundle.entry' })
  }

  // NHS Number check digit — Modulus 11 algorithm per
  // https://www.datadictionary.nhs.uk/attributes/nhs_number.html
  for (const patient of patients) {
    const nhsIdentifier = patient.identifier?.find(
      i => i.system?.includes('nhs-number') || i.system?.includes('PDS')
    )
    if (nhsIdentifier?.value) {
      req(tracker, issues, isValidNhsNumber(nhsIdentifier.value), 'error',
        `NHS Number "${nhsIdentifier.value}" fails the Modulus 11 check digit validation`,
        `Patient/${patient.id}`, patient.id,
        'NHS Number check digit is valid')
    }
  }

  // List resources
  const lists = getEntries<fhir3.List>(bundle, 'List')
  tracker.record('At least one List resource is present', lists.length > 0)
  if (lists.length === 0) {
    issues.push({
      severity: 'warning',
      message: 'No List resource found — GP Connect bundles typically include a List to organise clinical entries',
      path: 'Bundle.entry',
    })
  }
  for (const list of lists) {
    const path = `List/${list.id}`
    req(tracker, issues, !!list.status, 'error', 'List.status is required', path, list.id)
    req(tracker, issues, !!list.mode, 'error', 'List.mode is required', path, list.id)
  }

  // MedicationStatement
  const statements = getEntries<fhir3.MedicationStatement>(bundle, 'MedicationStatement')
  for (const stmt of statements) {
    const path = `MedicationStatement/${stmt.id}`
    req(tracker, issues, !!stmt.status, 'error', 'MedicationStatement.status is required', path, stmt.id)
    req(tracker, issues, !!(stmt.medicationReference || stmt.medicationCodeableConcept), 'error',
      'MedicationStatement must have medicationReference or medicationCodeableConcept', path, stmt.id)
    req(tracker, issues, !!stmt.subject, 'error', 'MedicationStatement.subject is required', path, stmt.id)
    req(tracker, issues, !!stmt.taken, 'warning',
      'MedicationStatement.taken is required in FHIR STU3 (GP Connect may use extension)', path, stmt.id)
  }

  // Medication
  const medications = getEntries<fhir3.Medication>(bundle, 'Medication')
  if (statements.length > 0) {
    tracker.record('Medication resources are present when MedicationStatements exist', medications.length > 0)
    if (medications.length === 0) {
      issues.push({
        severity: 'warning',
        message: 'No Medication resources found — drug codes/names may be embedded in MedicationStatements instead',
        path: 'Bundle.entry',
      })
    }
  }
  for (const med of medications) {
    req(tracker, issues, !!med.code, 'warning', 'Medication.code is missing — drug name/SNOMED code recommended',
      `Medication/${med.id}`, med.id, 'Medication.code is present')
  }

  // MedicationRequest
  const requests = getEntries<fhir3.MedicationRequest>(bundle, 'MedicationRequest')
  for (const req_ of requests) {
    const path = `MedicationRequest/${req_.id}`
    req(tracker, issues, !!req_.status, 'error', 'MedicationRequest.status is required', path, req_.id)
    req(tracker, issues, !!req_.intent, 'error', 'MedicationRequest.intent is required', path, req_.id)
  }

  // AllergyIntolerance
  const allergies = getEntries<fhir3.AllergyIntolerance>(bundle, 'AllergyIntolerance')
  for (const a of allergies) {
    const path = `AllergyIntolerance/${a.id}`
    req(tracker, issues, !!a.patient, 'error', 'AllergyIntolerance.patient is required', path, a.id)
    req(tracker, issues, !!a.code, 'warning', 'AllergyIntolerance.code (causative agent) is missing', path, a.id,
      'AllergyIntolerance.code (causative agent) is present')
  }

  // Condition (Problems)
  const conditions = getEntries<fhir3.Condition>(bundle, 'Condition')
  for (const c of conditions) {
    const path = `Condition/${c.id}`
    req(tracker, issues, !!c.subject, 'error', 'Condition.subject is required', path, c.id)
    req(tracker, issues, !!c.code, 'warning', 'Condition.code (SNOMED) is missing', path, c.id,
      'Condition.code (SNOMED) is present')
  }

  // Encounter (Consultations)
  const encounters = getEntries<fhir3.Encounter>(bundle, 'Encounter')
  for (const e of encounters) {
    const path = `Encounter/${e.id}`
    req(tracker, issues, !!e.status, 'error', 'Encounter.status is required', path, e.id)
  }

  // Immunization
  const immunizations = getEntries<fhir3.Immunization>(bundle, 'Immunization')
  for (const imm of immunizations) {
    const path = `Immunization/${imm.id}`
    req(tracker, issues, !!imm.status, 'error', 'Immunization.status is required', path, imm.id)
    req(tracker, issues, imm.notGiven !== undefined, 'error', 'Immunization.notGiven is required in FHIR STU3', path, imm.id)
    req(tracker, issues, !!imm.vaccineCode, 'error', 'Immunization.vaccineCode is required', path, imm.id)
    req(tracker, issues, !!imm.patient, 'error', 'Immunization.patient is required', path, imm.id)
  }

  // DiagnosticReport (Investigations)
  const reports = getEntries<fhir3.DiagnosticReport>(bundle, 'DiagnosticReport')
  for (const r of reports) {
    const path = `DiagnosticReport/${r.id}`
    req(tracker, issues, !!r.status, 'error', 'DiagnosticReport.status is required', path, r.id)
    req(tracker, issues, !!r.code, 'error', 'DiagnosticReport.code is required', path, r.id)
  }

  // Observation (Coded Data + Investigation results)
  const observations = getEntries<fhir3.Observation>(bundle, 'Observation')
  for (const o of observations) {
    const path = `Observation/${o.id}`
    req(tracker, issues, !!o.status, 'error', 'Observation.status is required', path, o.id)
    req(tracker, issues, !!o.code, 'error', 'Observation.code is required', path, o.id)
  }

  // ReferralRequest
  const referrals = getEntries<fhir3.ReferralRequest>(bundle, 'ReferralRequest')
  for (const r of referrals) {
    const path = `ReferralRequest/${r.id}`
    req(tracker, issues, !!r.status, 'error', 'ReferralRequest.status is required', path, r.id)
    req(tracker, issues, !!r.intent, 'error', 'ReferralRequest.intent is required', path, r.id)
  }

  // DocumentReference (Documents)
  const docRefs = getEntries<fhir3.DocumentReference>(bundle, 'DocumentReference')
  for (const d of docRefs) {
    const path = `DocumentReference/${d.id}`
    req(tracker, issues, !!d.status, 'error', 'DocumentReference.status is required', path, d.id)
    req(tracker, issues, !!d.type, 'warning', 'DocumentReference.type (document category) is missing', path, d.id,
      'DocumentReference.type (document category) is present')
    req(tracker, issues, (d.content?.length ?? 0) > 0, 'warning', 'DocumentReference.content is empty — no attachment', path, d.id,
      'DocumentReference.content has an attachment')
  }

  // ProcedureRequest (Diary Entries)
  const procedureRequests = getEntries<fhir3.ProcedureRequest>(bundle, 'ProcedureRequest')
  for (const p of procedureRequests) {
    const path = `ProcedureRequest/${p.id}`
    req(tracker, issues, !!p.status, 'error', 'ProcedureRequest.status is required', path, p.id)
    req(tracker, issues, !!p.intent, 'error', 'ProcedureRequest.intent is required', path, p.id)
    req(tracker, issues, !!p.subject, 'error', 'ProcedureRequest.subject is required', path, p.id)
    req(tracker, issues, !!p.code, 'warning', 'ProcedureRequest.code (procedure type) is missing', path, p.id,
      'ProcedureRequest.code (procedure type) is present')
  }

  // ─── GP Connect-specific checks ─────────────────────────────────────────────

  const refIndex = buildReferenceIndex(bundle)

  // NOPAT security labels (patient-restricted information) — an informational
  // note, not a pass/fail check, so it's never tracked as a "test".
  for (const entry of bundle.entry ?? []) {
    const r = entry.resource as AnyResource | undefined
    if (!r) continue
    const hasNopat = (r.meta?.security ?? []).some((s: fhir3.Coding) => s.code === 'NOPAT')
    if (hasNopat) {
      issues.push({
        severity: 'info',
        message: 'Patient-restricted information present (NOPAT security label)',
        path: `${r.resourceType}/${r.id}`,
        resourceId: r.id,
      })
    }
  }

  // All subject/patient references should point to the same Patient
  const patientRefs = new Set<string>()
  const addPatientRef = (ref: string | undefined) => { if (ref) patientRefs.add(ref) }
  statements.forEach(s => addPatientRef(s.subject?.reference))
  allergies.forEach(a => addPatientRef(a.patient?.reference))
  conditions.forEach(c => addPatientRef(c.subject?.reference))
  encounters.forEach(e => addPatientRef(e.subject?.reference))
  immunizations.forEach(i => addPatientRef(i.patient?.reference))
  reports.forEach(r => addPatientRef(r.subject?.reference))
  observations.forEach(o => addPatientRef(o.subject?.reference))
  procedureRequests.forEach(p => addPatientRef(p.subject?.reference))
  tracker.record('All clinical resources reference the same Patient', patientRefs.size <= 1)
  if (patientRefs.size > 1) {
    issues.push({
      severity: 'warning',
      message: `Resources reference ${patientRefs.size} different patients — bundle must represent a single patient`,
      path: 'Bundle',
    })
  }

  // MedicationStatement: medicationReference must resolve; warn if inline code used instead
  for (const stmt of statements) {
    if (stmt.medicationReference?.reference) {
      req(tracker, issues, resolves(stmt.medicationReference.reference, refIndex), 'warning',
        'MedicationStatement.medicationReference does not resolve to a bundle entry',
        `MedicationStatement/${stmt.id}`, stmt.id,
        'MedicationStatement.medicationReference resolves to a bundle entry')
    }
    const usesInlineCode = !stmt.medicationReference && !!stmt.medicationCodeableConcept
    if (stmt.medicationReference || stmt.medicationCodeableConcept) {
      tracker.record('MedicationStatement uses a Medication reference (not inline code)', !usesInlineCode)
    }
    if (usesInlineCode) {
      issues.push({
        severity: 'info',
        message: 'MedicationStatement uses inline medicationCodeableConcept — GP Connect expects a Reference to a Medication resource',
        path: `MedicationStatement/${stmt.id}`,
        resourceId: stmt.id,
      })
    }
  }

  // Resolved allergies must be in List.contained, not top-level bundle entries
  for (const a of allergies) {
    if (a.clinicalStatus === 'resolved') {
      // Resolved AllergyIntolerances reached via getEntries() are by definition
      // top-level bundle entries (that's what getEntries scans) — so finding
      // one here always means the check has failed; there's no "resolved and
      // correctly in List.contained" case to also count as a pass.
      tracker.record('No resolved allergies stored as top-level entries', false)
      issues.push({
        severity: 'warning',
        message: 'Resolved AllergyIntolerance is a top-level bundle entry — GP Connect requires resolved allergies inside List.contained (ended-allergies List)',
        path: `AllergyIntolerance/${a.id}`,
        resourceId: a.id,
      })
    }
  }
  if (allergies.length > 0 && !allergies.some(a => a.clinicalStatus === 'resolved')) {
    tracker.record('No resolved allergies stored as top-level entries', true)
  }

  // MedicationRequest.intent should be 'plan' (authorisation) or 'order' (issue)
  for (const mr of requests) {
    if (mr.intent) {
      const validIntent = ['plan', 'order'].includes(mr.intent)
      tracker.record('MedicationRequest.intent is "plan" or "order"', validIntent)
      if (!validIntent) {
        issues.push({
          severity: 'info',
          message: `MedicationRequest.intent is "${mr.intent}" — GP Connect uses "plan" (authorisation) or "order" (issue)`,
          path: `MedicationRequest/${mr.id}`,
          resourceId: mr.id,
        })
      }
    }
  }

  // Encounters should carry a plain-text entry in type[] — this is what
  // marks the Encounter as a GP Connect consultation record. Confirmed
  // against a real GP Connect Encounter (TPP): { "type": [{ "text": "Clinical" }] } —
  // no coding, no dedicated codesystem. The text value itself isn't fixed
  // by the spec, so any non-empty text entry satisfies this.
  for (const e of encounters) {
    const hasConsultationType = (e.type ?? []).some(t => !!t.text)
    req(tracker, issues, hasConsultationType, 'info',
      'Encounter.type does not include a text record type entry',
      `Encounter/${e.id}`, e.id,
      'Encounter.type includes a text record type entry')
  }

  // Lists should have a code; primary Lists should use a known GP Connect SNOMED code
  for (const list of lists) {
    const codings = list.code?.coding ?? []
    const hasCode = codings.length > 0 || !!list.code?.text
    tracker.record('List has a code', hasCode)
    if (!hasCode) {
      issues.push({
        severity: 'info',
        message: 'List has no code — GP Connect primary Lists identify their clinical area with a SNOMED CT code',
        path: `List/${list.id}`,
        resourceId: list.id,
      })
    } else {
      const snomedCodes = codings
        .filter(c => c.system === 'http://snomed.info/sct')
        .map(c => c.code)
        .filter((c): c is string => !!c)
      if (snomedCodes.length > 0) {
        const recognised = snomedCodes.some(c => GP_CONNECT_KNOWN_LIST_CODES.has(c))
        tracker.record('List SNOMED code is a recognised GP Connect list code', recognised)
        if (!recognised) {
          issues.push({
            severity: 'info',
            message: `List SNOMED code(s) [${snomedCodes.join(', ')}] are not a recognised GP Connect list code`,
            path: `List/${list.id}`,
            resourceId: list.id,
          })
        }
      }
    }
  }

  // ─── Dangling reference check ────────────────────────────────────────────────
  // Walk every resource and collect all { reference: string } objects.
  // Each ref must resolve to a bundle entry. Local contained refs (#id) are
  // always skipped; absolute URLs (http/https/urn) are skipped as they point
  // to external systems outside this bundle.

  function collectRefs(obj: unknown, refs: Array<{ ref: string; path: string }>, path: string) {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => collectRefs(item, refs, `${path}[${i}]`))
      return
    }
    const record = obj as Record<string, unknown>
    if (typeof record.reference === 'string' && record.reference) {
      refs.push({ ref: record.reference, path })
    }
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'reference') collectRefs(value, refs, `${path}.${key}`)
    }
  }

  for (const entry of bundle.entry ?? []) {
    const r = entry.resource as AnyResource | undefined
    if (!r) continue
    const resourcePath = `${r.resourceType}/${r.id ?? '(no id)'}`
    const refs: Array<{ ref: string; path: string }> = []
    collectRefs(r, refs, resourcePath)
    for (const { ref, path } of refs) {
      if (ref.startsWith('#')) continue           // local contained — always valid
      if (/^https?:\/\/|^urn:/.test(ref)) continue // external URL — out of scope
      req(tracker, issues, resolves(ref, refIndex), 'warning',
        `Reference "${ref}" does not resolve to any resource in this bundle`,
        path, r.id,
        'All references resolve to a bundle entry')
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error')
  return { valid: !hasErrors, issues, resourceCounts, passed: tracker.passedTitles() }
}

// Backward-compat alias
export const validateMedicationsBundle = validateBundle

// Remove all unresolvable references from a bundle.
// Returns the cleaned bundle and the number of reference strings removed.
// Local contained refs (#id) and absolute URLs (http/https/urn) are left untouched.
export function cleanDanglingRefs(bundle: fhir3.Bundle): { bundle: fhir3.Bundle; removedCount: number } {
  const index = buildReferenceIndex(bundle)
  let removedCount = 0

  function clean(obj: unknown): unknown {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) {
      return (obj as unknown[]).map(clean).filter(item => item !== null)
    }
    const record = obj as Record<string, unknown>
    let refRemoved = false
    if (typeof record.reference === 'string' && record.reference) {
      const ref = record.reference
      if (!ref.startsWith('#') && !/^https?:\/\/|^urn:/.test(ref) && !index.has(ref)) {
        refRemoved = true
        removedCount++
      }
    }
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (key === 'reference' && refRemoved) continue
      result[key] = clean(value)
    }
    // Object was purely {reference: "..."} and ref was removed — signal parent to drop it
    if (refRemoved && Object.keys(result).length === 0) return null
    return result
  }

  return { bundle: clean(bundle) as fhir3.Bundle, removedCount }
}
