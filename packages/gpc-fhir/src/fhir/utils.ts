import type { GpConnectPatient, GpConnectContact, GpConnectCodedDataItem } from './types'

export type AnyResource = fhir3.Resource & { resourceType: string }

// Some vendor exports include the exact same resource id twice within a
// single bundle (invalid per the FHIR spec, but seen in real GP Connect
// exports) — de-duplicate by id, keeping the first occurrence, so callers
// never see the same clinical record rendered as two rows.
export function getEntries<T extends fhir3.Resource>(bundle: fhir3.Bundle, resourceType: string): T[] {
  const seenIds = new Set<string>()
  const results: (T & AnyResource)[] = []
  for (const entry of bundle.entry ?? []) {
    const r = entry.resource as AnyResource | undefined
    if (r?.resourceType !== resourceType) continue
    if (r.id) {
      if (seenIds.has(r.id)) continue
      seenIds.add(r.id)
    }
    results.push(r as T & AnyResource)
  }
  return results
}

export function resolveReference(bundle: fhir3.Bundle, ref: string | undefined): AnyResource | undefined {
  if (!ref) return undefined
  // Local contained reference (#id) — search all List.contained[] arrays
  if (ref.startsWith('#')) {
    const localId = ref.slice(1)
    for (const entry of bundle.entry ?? []) {
      const contained = (entry.resource as { contained?: fhir3.Resource[] } | undefined)?.contained
      if (contained) {
        const found = contained.find(c => c.id === localId)
        if (found) return found as AnyResource
      }
    }
    return undefined
  }
  return (bundle.entry ?? [])
    .map(e => e.resource as AnyResource | undefined)
    .find(r => {
      if (!r) return false
      const relRef = `${r.resourceType}/${r.id}`
      // Match by ResourceType/id only. The bare-id fallback (ref.endsWith(`/${r.id}`))
      // is intentionally omitted: it ignores resource type and causes wrong matches
      // when two resources share the same id (e.g. Organization/1 matching Patient/1).
      return ref === relRef || ref.endsWith(`/${relRef}`)
    })
}

/** Returns a lexicographically sortable key from any FHIR date/datetime string.
 *  Partial dates are padded so year < year-month < year-month-day ordering is preserved.
 *  Missing dates return '' so they sort to the end of a descending sort. */
export function fhirDateKey(dateStr: string | undefined | null): string {
  if (!dateStr) return ''
  if (/^\d{4}$/.test(dateStr)) return `${dateStr}-00-00`
  if (/^\d{4}-\d{2}$/.test(dateStr)) return `${dateStr}-00`
  return dateStr.substring(0, 10)
}

export function formatDate(dateStr: string | undefined): string | undefined {
  if (!dateStr) return undefined

  // Year-only: "1989"
  if (/^\d{4}$/.test(dateStr)) return dateStr

  // Year-month: "1985-04" → "Apr 1985"
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    const [y, m] = dateStr.split('-').map(Number)
    try {
      return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    } catch {
      return dateStr
    }
  }

  try {
    // Date-only "YYYY-MM-DD" — parse as UTC to avoid timezone-shift rendering as previous day
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number)
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    }
    // Datetime with timezone info — let the engine handle it in local time
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return dateStr
  }
}

/** Formats a coded-data item's value for display, falling back to pairing
 * systolic/diastolic components (e.g. blood pressure) when there's no
 * top-level value — used so the Coded Data view, Consultations view, and
 * Inspector all show BP-style composite observations the same way. */
export function formatCodedDataValue(item: GpConnectCodedDataItem): string | undefined {
  if (item.value !== undefined || item.unit) {
    return [item.value, item.unit].filter(Boolean).join(' ')
  }
  if (item.components?.length) {
    const sys = item.components.find(c => /systolic/i.test(c.name))
    const dia = item.components.find(c => /diastolic/i.test(c.name))
    if (sys?.value !== undefined && dia?.value !== undefined) {
      const unit = sys.unit ?? dia.unit
      return [sys.value + '/' + dia.value, unit].filter(Boolean).join(' ') || undefined
    }
  }
  return undefined
}

export function getExtensionValue(extensions: fhir3.Extension[] | undefined, url: string): fhir3.Extension | undefined {
  return extensions?.find(e => e.url === url || e.url?.endsWith(url))
}

/** Whether a resource carries the NOPAT security label (withheld from patient-facing services) —
 * see https://simplifier.net/guide/gpconnect-data-model/Home/Build/FHIR-resources — "Resources not to be disclosed to a patient". */
export function hasNopatSecurity(resource: { meta?: fhir3.Meta } | undefined): boolean {
  return (resource?.meta?.security ?? []).some(s => s.code === 'NOPAT')
}

/** Extract SNOMED CT code from a coding array, preferring system='http://snomed.info/sct' over coding[0].
 *  Needed because EMIS places proprietary/Read v2 codes as coding[0] with SNOMED as coding[1]. */
export function extractSnomedCode(codings: fhir3.Coding[] | undefined): string | undefined {
  if (!codings?.length) return undefined
  return codings.find(c => c.system === 'http://snomed.info/sct')?.code ?? codings[0].code
}

export function extractSnomedDisplay(codings: fhir3.Coding[] | undefined): string | undefined {
  if (!codings?.length) return undefined
  return codings.find(c => c.system === 'http://snomed.info/sct')?.display ?? codings[0].display
}

// GP Connect (STU3) carries the SNOMED description display via the complex
// "coding-sctdescid" extension — a wrapper extension with nested
// descriptionId/descriptionDisplay sub-extensions, NOT a flat valueString —
// e.g. { url: '.../Extension-coding-sctdescid', extension: [
//   { url: 'descriptionId', valueId: '...' },
//   { url: 'descriptionDisplay', valueString: '...' },
// ] }. This is the CareConnect/GP Connect STU3 shape (confirmed against a
// real EMIS-exported bundle); the UK Core R4 IG names an equivalent
// extension slightly differently, but this app only ever sees STU3 data.
const CODING_SCT_DESC_ID_EXT = 'Extension-coding-sctdescid'

function findDescriptionDisplay(coding: fhir3.Coding): string | undefined {
  const wrapper = getExtensionValue(coding.extension, CODING_SCT_DESC_ID_EXT)
  const subExtensions = (wrapper as unknown as { extension?: fhir3.Extension[] } | undefined)?.extension
  const valueString = subExtensions?.find(e => e.url === 'descriptionDisplay')?.valueString
  return typeof valueString === 'string' && valueString ? valueString : undefined
}

// A coding counts as "the one the user selected" if it says so explicitly,
// or — per the UK Core guidance below — if userSelected is simply absent
// and it's the only coding present (nothing else it could have been).
function isEffectivelyUserSelected(coding: fhir3.Coding, codingCount: number): boolean {
  if (coding.userSelected === true) return true
  return coding.userSelected === undefined && codingCount === 1
}

/**
 * Original term text precedence per the UK Core CodeableConcept guidance —
 * https://simplifier.net/guide/uk-core-implementation-guide/home/guidance/codeableconcept-guidance.html?version=1.0.0#Original-term-text
 * 1. CodeableConcept.text, if present.
 * 2. The user-selected coding's description-display extension, if present.
 * 3. The user-selected coding's display.
 * 4. (Not covered by the guidance — a fallback for when no coding is
 *    identifiably user-selected) the SNOMED CT coding's display, or the
 *    first coding's display.
 */
export function extractOriginalTermText(cc: fhir3.CodeableConcept | undefined): string | undefined {
  if (!cc) return undefined
  if (cc.text) return cc.text

  const codings = cc.coding ?? []
  const selected = codings.find(c => isEffectivelyUserSelected(c, codings.length))
  if (selected) {
    const descDisplay = findDescriptionDisplay(selected)
    if (descDisplay) return descDisplay
    if (selected.display) return selected.display
  }

  return extractSnomedDisplay(codings)
}

export function resolveResourceName(bundle: fhir3.Bundle, ref: string | undefined): string | undefined {
  if (!ref) return undefined
  const resource = resolveReference(bundle, ref)
  if (!resource) return undefined
  if (resource.resourceType === 'Practitioner') return resolvePractitionerName(bundle, ref)
  if (resource.resourceType === 'Organization') return (resource as fhir3.Organization).name
  if (resource.resourceType === 'HealthcareService') return (resource as unknown as { name?: string }).name
  return undefined
}

export function getOrganisationName(bundle: fhir3.Bundle): string | undefined {
  const org = getEntries<fhir3.Organization>(bundle, 'Organization')[0]
  return org?.name
}

export function extractId(ref: string | undefined): string | undefined {
  if (!ref) return undefined
  return ref.split('/').pop()
}

export function resolvePractitionerRef(
  bundle: fhir3.Bundle,
  ref: string | undefined
): { name?: string; id?: string } {
  if (!ref) return {}
  return { name: resolvePractitionerName(bundle, ref), id: extractId(ref) }
}

export function resolvePractitionerName(bundle: fhir3.Bundle, ref: string | undefined): string | undefined {
  if (!ref) return undefined
  const practitioner = resolveReference(bundle, ref) as fhir3.Practitioner | undefined
  if (!practitioner) return undefined
  const name = practitioner.name?.[0]
  if (!name) return undefined
  const given = (name.given ?? []).join(' ')
  const family = name.family ?? ''
  const prefix = (name.prefix ?? []).join(' ')
  return [prefix, given, family].filter(Boolean).join(' ')
}

/** Resolve a human-readable label for any clinical resource referenced by a FHIR reference string. */
export function resolveItemDisplay(bundle: fhir3.Bundle, ref: string | undefined): string | undefined {
  if (!ref) return undefined
  const resource = resolveReference(bundle, ref) as AnyResource & Record<string, any> | undefined
  if (!resource) return undefined
  const r = resource as Record<string, any>

  // Encounter: type is an array — pick first entry's original term text
  if (resource.resourceType === 'Encounter') {
    const typeArr = r.type as fhir3.CodeableConcept[] | undefined
    return extractOriginalTermText(typeArr?.[0])
  }

  // MedicationStatement / MedicationRequest: follow medicationReference to Medication resource
  if (resource.resourceType === 'MedicationStatement' || resource.resourceType === 'MedicationRequest') {
    const inline = extractOriginalTermText(r.medicationCodeableConcept as fhir3.CodeableConcept | undefined)
    if (inline) return inline
    const medRef = (r.medicationReference as { reference?: string } | undefined)?.reference
    if (medRef) {
      const med = resolveReference(bundle, medRef) as Record<string, any> | undefined
      return extractOriginalTermText(med?.code as fhir3.CodeableConcept | undefined)
    }
    return undefined
  }

  // Immunization: vaccineCode is often a NullFlavor placeholder ("unknown"/UNK) —
  // fall back to the VaccinationProcedure extension, which carries the real term.
  if (resource.resourceType === 'Immunization') {
    const vaccineCodings = r.vaccineCode?.coding as fhir3.Coding[] | undefined
    const isNullFlavor = vaccineCodings?.every(c => c.system === 'http://hl7.org/fhir/v3/NullFlavor')
    const vaccineDisplay = isNullFlavor ? r.vaccineCode?.text : extractOriginalTermText(r.vaccineCode as fhir3.CodeableConcept | undefined)
    if (vaccineDisplay) return vaccineDisplay
    const vpExt = getExtensionValue(r.extension, 'Extension-CareConnect-VaccinationProcedure-1')
    const vpCC = vpExt?.valueCodeableConcept as fhir3.CodeableConcept | undefined
    return extractOriginalTermText(vpCC)
  }

  const codeName =
    extractOriginalTermText(r.code as fhir3.CodeableConcept | undefined) ??
    extractOriginalTermText(r.vaccineCode as fhir3.CodeableConcept | undefined) ??
    extractOriginalTermText(r.medicationCodeableConcept as fhir3.CodeableConcept | undefined) ??
    extractOriginalTermText(r.type as fhir3.CodeableConcept | undefined) ??
    r.description as string | undefined

  if (resource.resourceType === 'Observation') {
    let valueStr: string | undefined
    if (typeof r.valueString === 'string') {
      valueStr = r.valueString
    } else if (r.valueQuantity) {
      const v = r.valueQuantity.value !== undefined ? String(r.valueQuantity.value) : ''
      const u = r.valueQuantity.unit ?? r.valueQuantity.code ?? ''
      valueStr = [v, u].filter(Boolean).join(' ')
    } else if (r.valueCodeableConcept) {
      valueStr = extractOriginalTermText(r.valueCodeableConcept as fhir3.CodeableConcept | undefined)
    } else if (typeof r.valueBoolean === 'boolean') {
      valueStr = r.valueBoolean ? 'Yes' : 'No'
    } else if (r.component?.length) {
      // e.g. blood pressure — show as "val1 / val2 unit"
      const parts = (r.component as any[]).map(c => {
        const v = c.valueQuantity?.value
        const u = c.valueQuantity?.unit ?? ''
        return v !== undefined ? `${v} ${u}`.trim() : undefined
      }).filter(Boolean)
      if (parts.length) valueStr = parts.join(' / ')
    }
    if (codeName && valueStr) return `${codeName}: ${valueStr}`
    return codeName ?? valueStr
  }

  if (resource.resourceType === 'Practitioner') {
    const name = r.name?.[0]
    if (name) return [name.prefix?.join(' '), name.given?.join(' '), name.family].filter(Boolean).join(' ')
  }
  if (resource.resourceType === 'Organization') return r.name as string | undefined
  if (resource.resourceType === 'ReferralRequest') {
    const reasonCC = (r.reasonCode as fhir3.CodeableConcept[] | undefined)?.[0]
    return extractOriginalTermText(reasonCC) ?? (r.description as string | undefined)
  }

  return codeName
}

export function extractPatientInfo(bundle: fhir3.Bundle): GpConnectPatient | undefined {
  const patient = getEntries<fhir3.Patient>(bundle, 'Patient')[0]
  if (!patient) return undefined

  const id = patient.id

  // NHS number + verification status
  const nhsIdentifier = patient.identifier?.find(
    id => id.system?.includes('nhs-number') || id.system?.includes('PDS')
  )
  const nhsNumber = nhsIdentifier?.value
  const nhsVerifyExt = (nhsIdentifier?.extension ?? []).find(e =>
    e.url?.includes('NHSNumberVerificationStatus')
  )
  const nhsVerifyCoding = (nhsVerifyExt?.valueCodeableConcept as any)?.coding?.[0]
  const nhsNumberVerified = nhsVerifyCoding !== undefined ? nhsVerifyCoding.code === '01' : undefined
  const nhsNumberVerificationDisplay = nhsVerifyCoding?.display as string | undefined

  const name = patient.name?.[0]
  const prefix = (name?.prefix ?? []).join(' ') || undefined
  const given = (name?.given ?? []).join(' ')
  const family = name?.family ?? ''

  const isActive = patient.active

  // Registration extension
  const regExt = (patient.extension ?? []).find(e => e.url?.includes('RegistrationDetails'))
  const regSubExts = (regExt as any)?.extension as Array<{ url: string; [k: string]: any }> | undefined ?? []
  const registrationType = regSubExts.find(e => e.url === 'registrationType')
    ?.valueCodeableConcept?.coding?.[0]?.display as string | undefined
  const regPeriodStart = regSubExts.find(e => e.url === 'registrationPeriod')
    ?.valuePeriod?.start as string | undefined
  const registrationStart = formatDate(regPeriodStart)

  // Preferred branch surgery — resolve by id from bundle
  const branchRef = regSubExts.find(e => e.url === 'preferredBranchSurgery')
    ?.valueReference?.reference as string | undefined
  const branchId = extractId(branchRef)
  const branchResource = branchId
    ? (bundle.entry ?? []).find(e => (e.resource as any)?.id === branchId)?.resource as any
    : undefined
  const preferredBranchSurgery = branchResource?.name as string | undefined

  // Address
  const addr = patient.address?.find(a => a.use === 'home') ?? patient.address?.[0]
  const address = addr
    ? [...(addr.line ?? []), addr.city, addr.district, addr.postalCode].filter(Boolean).join(', ')
    : undefined

  // Telecom
  const telecoms = patient.telecom ?? []
  const phone = telecoms.find(t => t.system === 'phone')?.value
  const email = telecoms.find(t => t.system === 'email')?.value

  // Registered GP
  const gpRef = (patient.generalPractitioner as fhir3.Reference[] | undefined)?.[0]?.reference
  const gpId = gpRef ? extractId(gpRef) : undefined
  const gpResource = gpId
    ? (bundle.entry ?? []).find(e => (e.resource as any)?.id === gpId)?.resource as fhir3.Practitioner | undefined
    : undefined
  const gpName = gpResource
    ? (() => {
        const n = gpResource.name?.[0]
        return [n?.prefix?.join(' '), n?.given?.join(' '), n?.family].filter(Boolean).join(' ') || undefined
      })()
    : undefined

  // Managing organisation
  const managingOrgRef = (patient.managingOrganization as fhir3.Reference | undefined)?.reference
  const managingOrgId = extractId(managingOrgRef)
  const managingOrgResource = resolveReference(bundle, managingOrgRef) as fhir3.Organization | undefined
  const managingOrganisationName = managingOrgResource?.name

  // Preferred spoken/written language (NHSCommunication extension)
  const commExts = (patient.extension ?? []).filter(e => e.url?.includes('NHSCommunication'))
  const commSubExtsList = commExts.map(
    e => (e as any).extension as Array<{ url: string; [k: string]: any }> | undefined ?? []
  )
  const preferredCommSubExts =
    commSubExtsList.find(subs => subs.find(s => s.url === 'preferred')?.valueBoolean === true) ??
    commSubExtsList[0] ?? []
  const preferredLanguage = preferredCommSubExts.find(e => e.url === 'language')
    ?.valueCodeableConcept?.coding?.[0]?.display as string | undefined
  const communicationProficiency = preferredCommSubExts.find(e => e.url === 'communicationProficiency')
    ?.valueCodeableConcept?.coding?.[0]?.display as string | undefined
  const modeOfCommunication = preferredCommSubExts.find(e => e.url === 'modeOfCommunication')
    ?.valueCodeableConcept?.coding?.[0]?.display as string | undefined
  const interpreterRequired = preferredCommSubExts.find(e => e.url === 'interpreterRequired')
    ?.valueBoolean as boolean | undefined

  // Next of kin / emergency contact
  const contacts: GpConnectContact[] = (patient.contact ?? []).map(c => {
    const cn = c.name
    const contactName = [
      (cn?.prefix ?? []).join(' '),
      (cn?.given ?? []).join(' '),
      cn?.family,
    ].filter(Boolean).join(' ') || undefined
    const relationship = (c.relationship ?? [])
      .map(r => extractOriginalTermText(r))
      .filter(Boolean)
      .join(', ') || undefined
    const contactPhone = c.telecom?.find(t => t.system === 'phone')?.value
    return { name: contactName, relationship, phone: contactPhone, gender: c.gender }
  })

  return {
    id,
    nhsNumber,
    nhsNumberVerified,
    nhsNumberVerificationDisplay,
    prefix,
    familyName: family || undefined,
    givenName: given || undefined,
    dateOfBirth: formatDate(patient.birthDate),
    gender: patient.gender,
    isActive,
    registrationType,
    registrationStart,
    preferredBranchSurgery,
    address,
    phone,
    email,
    registeredGpName: gpName,
    registeredGpId: gpId,
    preferredLanguage,
    interpreterRequired,
    communicationProficiency,
    modeOfCommunication,
    managingOrganisationName,
    managingOrganisationId: managingOrgId,
    contacts: contacts.length ? contacts : undefined,
  }
}
