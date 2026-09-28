import type { GpConnectAllergy, GpConnectAllergyNote } from './types'
import { getEntries, formatDate, resolvePractitionerRef, getExtensionValue, extractSnomedCode, extractOriginalTermText, extractId, fhirDateKey, hasNopatSecurity } from './utils'

const END_EXT = 'Extension-CareConnect-GPC-AllergyIntoleranceEnd-1'

const ENDED_ALLERGIES_CODE = '1103671000000101'

export function extractAllergies(bundle: fhir3.Bundle): GpConnectAllergy[] {
  const topLevel = getEntries<fhir3.AllergyIntolerance>(bundle, 'AllergyIntolerance')

  // Resolved allergies are contained within the "Ended allergies" list per GP Connect spec
  const endedList = getEntries<fhir3.List>(bundle, 'List')
    .find(list => list.code?.coding?.some(c => c.code === ENDED_ALLERGIES_CODE))
  const contained = ((endedList as unknown as { contained?: fhir3.Resource[] })?.contained ?? [])
    .filter((r): r is fhir3.AllergyIntolerance => (r as unknown as { resourceType?: string }).resourceType === 'AllergyIntolerance')

  // Some suppliers (e.g. TPP) duplicate resolved allergies: once as a top-level
  // entry and again inside the "Ended allergies" List's contained array.
  const seenIds = new Set<string>()
  const combined = [...topLevel, ...contained].filter(resource => {
    if (!resource.id) return true
    if (seenIds.has(resource.id)) return false
    seenIds.add(resource.id)
    return true
  })

  return combined
    .sort((a, b) => fhirDateKey((b as unknown as {assertedDate?: string}).assertedDate).localeCompare(fhirDateKey((a as unknown as {assertedDate?: string}).assertedDate)))
    .map(resource => {
    const coding = resource.code?.coding
    // Prefer SNOMED CT coding — EMIS places Read v2 at coding[0]
    const snomedCoding = coding?.find(c => c.system === 'http://snomed.info/sct') ?? coding?.[0]
    const snomedCode = extractSnomedCode(coding)
    const snomedDisplay = snomedCoding?.display

    const reactionManifestation = extractOriginalTermText(resource.reaction?.[0]?.manifestation?.[0])
    const reactionDescription = (resource.reaction?.[0] as unknown as { description?: string })?.description

    const rawNotes = (resource.note ?? []) as unknown as Array<{
      text?: string
      authorReference?: { reference?: string }
      time?: string
    }>
    const notes: GpConnectAllergyNote[] = rawNotes.map(n => {
      const { name: author, id: authorId } = resolvePractitionerRef(bundle, n.authorReference?.reference)
      return { text: n.text ?? '', author, authorId, time: formatDate(n.time) }
    })

    const recorderFhirRef = resource.recorder as fhir3.Reference | undefined
    const recorderRef = recorderFhirRef?.reference
    const { name: recorderResolved, id: recorderId } = resolvePractitionerRef(bundle, recorderRef)
    const recorder = recorderResolved ?? recorderFhirRef?.display

    const asserterFhirRef = (resource as unknown as { asserter?: fhir3.Reference }).asserter
    const asserterRef = asserterFhirRef?.reference
    const { name: asserterResolved, id: asserterId } = resolvePractitionerRef(bundle, asserterRef)
    const asserter = asserterResolved ?? asserterFhirRef?.display

    const encounterExtRef = (resource.extension ?? [])
      .find(e => e.url === 'http://hl7.org/fhir/StructureDefinition/encounter-associatedEncounter')
    const encounterId = extractId((encounterExtRef?.valueReference as fhir3.Reference | undefined)?.reference)

    const endExt = getExtensionValue(resource.extension, END_EXT)
    const endSubExts = (endExt as unknown as { extension?: fhir3.Extension[] } | undefined)?.extension
    const endDateRaw = endSubExts?.find(e => e.url === 'endDate')?.valueDateTime as string | undefined
    const endReason = endSubExts?.find(e => e.url === 'reasonEnded')?.valueString as string | undefined

    return {
      id: resource.id ?? crypto.randomUUID(),
      causativeAgent: extractOriginalTermText(resource.code) ?? 'Unknown',
      snomedCode,
      snomedDisplay,
      category: resource.category?.[0] as string | undefined,
      criticality: resource.criticality,
      reaction: reactionManifestation ?? reactionDescription,
      dateRecorded: formatDate((resource as unknown as { assertedDate?: string }).assertedDate),
      onsetDate: formatDate((resource as unknown as { onsetDateTime?: string }).onsetDateTime),
      status: resource.clinicalStatus ?? 'unknown',
      verificationStatus: resource.verificationStatus,
      notes,
      recorder,
      recorderId,
      asserter,
      asserterId,
      encounterId,
      endDate: formatDate(endDateRaw),
      endReason,
      notForPfs: hasNopatSecurity(resource),
    }
  })
}
