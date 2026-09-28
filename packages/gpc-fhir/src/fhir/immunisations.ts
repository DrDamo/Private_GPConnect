import type { GpConnectImmunisation } from './types'
import { getEntries, formatDate, resolvePractitionerRef, getExtensionValue, extractSnomedCode, extractOriginalTermText, extractId, fhirDateKey, hasNopatSecurity } from './utils'

const IMMUNISATIONS_LIST_CODE = '1102181000000102'

export function extractImmunisations(bundle: fhir3.Bundle): GpConnectImmunisation[] {
  const immunizationEntries = getEntries<fhir3.Immunization>(bundle, 'Immunization')
    .map(resource => {
    const cast = resource as unknown as Record<string, unknown>

    // VaccinationProcedure extension carries the real SNOMED code when vaccineCode = UNK
    const vpExt = getExtensionValue(resource.extension, 'Extension-CareConnect-VaccinationProcedure-1')
    const vpCC = vpExt?.valueCodeableConcept as fhir3.CodeableConcept | undefined
    const vaccinationProcedureCode = extractSnomedCode(vpCC?.coding)
    const vpSnomedCoding = vpCC?.coding?.find(c => c.system === 'http://snomed.info/sct') ?? vpCC?.coding?.[0]
    // display = clinical SNOMED term (for detail); text = short label including dose number
    const vaccinationProcedureDisplay = vpSnomedCoding?.display
    const vaccinationProcedureText = vpCC?.text

    // Date recorded extension (distinct from date given)
    const dateRecordedExt = getExtensionValue(resource.extension, 'Extension-CareConnect-DateRecorded-1')
    const dateRecorded = formatDate((dateRecordedExt?.valueDateTime ?? dateRecordedExt?.valueDate) as string | undefined)

    // Parent present extension
    const parentPresentExt = getExtensionValue(resource.extension, 'Extension-CareConnect-ParentPresent-1')
    const parentPresent = parentPresentExt?.valueBoolean as boolean | undefined

    const vaccineCodings = resource.vaccineCode?.coding
    const vaccineCodeIsNullFlavor = vaccineCodings?.every(c => c.system === 'http://hl7.org/fhir/v3/NullFlavor')
    const vaccineSnomedCode = extractSnomedCode(vaccineCodings)
    // Fall back to vaccination procedure code when vaccineCode is UNK
    const snomedCode = vaccineSnomedCode ?? vaccinationProcedureCode

    const site = resource.site
    const routeCC = cast.route as fhir3.CodeableConcept | undefined

    const practitioners = resource.practitioner ?? []
    function extractPractitionerByRole(roleCode: string) {
      // A single practitioner entry can carry more than one role code (e.g. both
      // EP and AP in its role.coding array) — check all codings, not just the first.
      const match = practitioners.find(p => p.role?.coding?.some(c => c.code === roleCode))
        ?? (roleCode === 'AP' ? practitioners.find(p => !(p.role?.coding?.length)) : undefined)
      if (!match) return { name: undefined, id: undefined }
      const ref = (match.actor as fhir3.Reference | undefined)?.reference
      const display = (match.actor as fhir3.Reference | undefined)?.display
      const { name: resolved, id } = resolvePractitionerRef(bundle, ref)
      return { name: resolved ?? display, id }
    }
    const { name: administeringPractitioner, id: administeringPractitionerId } = extractPractitionerByRole('AP')
    const { name: enteringPractitioner, id: enteringPractitionerId } = extractPractitionerByRole('EP')

    const cast2 = resource as unknown as { encounter?: { reference?: string }; location?: { reference?: string } }
    const encounterId = extractId(cast2.encounter?.reference)
    const locationId = extractId(cast2.location?.reference)
    const locationResource = locationId
      ? (bundle.entry ?? []).find(e => (e.resource as any)?.id === locationId)?.resource as fhir3.Location | undefined
      : undefined
    const locationName = locationResource?.name

    const explanationReason = (cast.explanation as any)?.reason?.[0] as fhir3.CodeableConcept | undefined
    const explanationReasonNotGiven = (cast.explanation as any)?.reasonNotGiven?.[0] as fhir3.CodeableConcept | undefined
    // When the vaccine wasn't given, the clinically meaningful reason lives in
    // explanation.reasonNotGiven (e.g. "Did not attend") rather than explanation.reason.
    const chosenExplanation = explanationReasonNotGiven ?? explanationReason
    const explanationCode = chosenExplanation?.coding?.[0]?.code
    const explanationDisplay = chosenExplanation?.coding?.[0]?.display
    const explanationText = chosenExplanation?.text
    const explanationIsReasonNotGiven = !!explanationReasonNotGiven

    return {
      id: resource.id ?? crypto.randomUUID(),
      vaccine: (vaccineCodeIsNullFlavor ? resource.vaccineCode?.text : extractOriginalTermText(resource.vaccineCode))
        ?? vaccinationProcedureDisplay
        ?? vaccinationProcedureText
        ?? 'Unknown',
      snomedCode,
      vaccinationProcedureCode,
      vaccinationProcedureDisplay,
      vaccinationProcedureText,
      // The raw vaccineCode's own label — left blank (not falling back to the
      // procedure name) when vaccineCode is a NullFlavor placeholder, so the
      // "Vaccine" column faithfully reflects only what vaccineCode itself says.
      vaccineCodeDisplay: vaccineCodeIsNullFlavor ? resource.vaccineCode?.text : extractOriginalTermText(resource.vaccineCode),
      dateGiven: formatDate(resource.date),
      dateRecorded,
      status: resource.status ?? 'unknown',
      notGiven: cast.notGiven as boolean | undefined,
      site: site?.text,
      siteDisplay: site?.coding?.[0]?.display,
      siteCode: site?.coding?.[0]?.code,
      route: extractOriginalTermText(routeCC),
      batchNumber: resource.lotNumber,
      expirationDate: formatDate(cast.expirationDate as string | undefined),
      administeringPractitioner,
      administeringPractitionerId,
      enteringPractitioner,
      enteringPractitionerId,
      locationId,
      locationName,
      encounterId,
      explanationCode,
      explanationDisplay,
      explanationText,
      explanationIsReasonNotGiven,
      parentPresent,
      notes: (resource.note ?? []).map(n => n.text ?? '').filter(Boolean),
      notForPfs: hasNopatSecurity(resource),
    }
  })

  // Immunisation-related Observations (declined/consent/contraindication/DNA)
  // referenced by the primary Immunisations List belong alongside actual
  // administered vaccines in this view — they also remain in Coded Data,
  // since that's their canonical FHIR home.
  const immsList = getEntries<fhir3.List>(bundle, 'List')
    .find(list => list.code?.coding?.some(c => c.code === IMMUNISATIONS_LIST_CODE))
  const observationIds = new Set(
    (immsList?.entry ?? [])
      .filter(e => e.item.reference?.startsWith('Observation/'))
      .map(e => extractId(e.item.reference))
      .filter((id): id is string => !!id)
  )
  const observationEntries: GpConnectImmunisation[] = getEntries<fhir3.Observation>(bundle, 'Observation')
    .filter(obs => obs.id && observationIds.has(obs.id))
    .map(obs => {
      const description = extractOriginalTermText(obs.code) ?? 'Unknown'
      // These Observations carry no vaccineCode of their own — their coded term
      // belongs in the Procedure column, matching how real Immunizations use
      // vaccinationProcedureDisplay for their coded entry.
      const comment = (obs as unknown as { comment?: string }).comment
      return {
        id: obs.id!,
        entryType: 'observation' as const,
        vaccine: description,
        vaccinationProcedureDisplay: description,
        dateGiven: formatDate((obs as unknown as { effectiveDateTime?: string }).effectiveDateTime),
        status: obs.status ?? 'unknown',
        notes: comment ? comment.split('\n').map(line => line.trim()).filter(Boolean) : [],
        codedDataId: obs.id,
        notForPfs: hasNopatSecurity(obs),
      }
    })

  return [...immunizationEntries, ...observationEntries]
    .sort((a, b) => fhirDateKey(b.dateGiven).localeCompare(fhirDateKey(a.dateGiven)))
}
