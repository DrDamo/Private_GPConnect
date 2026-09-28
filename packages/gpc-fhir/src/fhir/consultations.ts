import type {
  GpConnectConsultation,
  GpConnectConsultationTopic,
  GpConnectConsultationCategory,
  GpConnectConsultationItem,
} from './types'
import {
  getEntries,
  formatDate,
  resolvePractitionerRef,
  resolveReference,
  getOrganisationName,
  extractId,
  resolveItemDisplay,
  extractOriginalTermText,
  fhirDateKey,
  hasNopatSecurity,
  getExtensionValue,
} from './utils'

// SNOMED codes for consultation structure lists
const CONSULTATION_WRAPPER = '325851000000107'
const CONSULTATION_TOPIC   = '25851000000105'
const CONSULTATION_CATEGORY = '24781000000107'

function hasCode(list: fhir3.List, code: string): boolean {
  return list.code?.coding?.some(c => c.code === code) ?? false
}

function encRef(list: fhir3.List): string | undefined {
  return (list as unknown as { encounter?: { reference?: string } }).encounter?.reference
}

const COMMENT_NOTE_CODE = '37331000000100'

function itemFromRef(bundle: fhir3.Bundle, item: fhir3.Reference | undefined): GpConnectConsultationItem {
  const ref = item?.reference
  const resource = resolveReference(bundle, ref)
  const resourceType = ref?.split('/')[0] ?? ''
  const resourceId = extractId(ref) ?? ''

  if (resource?.resourceType === 'Observation') {
    const obs = resource as fhir3.Observation & { comment?: string }
    if (obs.code?.coding?.some(c => c.code === COMMENT_NOTE_CODE)) {
      return { resourceType, resourceId, narrativeText: obs.comment ?? '' }
    }
  }

  // No reference — the provider system couldn't export this clinical item
  // type and returned a free-text display-only placeholder instead
  // (GP Connect "Unsupported Clinical Items in Consultations").
  if (!ref && item?.display) {
    return { resourceType: 'Unsupported', resourceId: '', display: item.display }
  }

  return { resourceType, resourceId, display: resolveItemDisplay(bundle, ref) }
}

function buildTopic(
  bundle: fhir3.Bundle,
  topicList: fhir3.List,
  allLists: fhir3.List[],
): GpConnectConsultationTopic {
  const categories: GpConnectConsultationCategory[] = []
  const items: GpConnectConsultationItem[] = []

  for (const entry of topicList.entry ?? []) {
    const ref = entry.item.reference
    if (ref?.startsWith('List/') || (!ref?.includes('/') && false)) {
      // Entry references another List — look it up
      const subList = allLists.find(l => l.id && ref?.endsWith(`/${l.id}`))
      if (subList && hasCode(subList, CONSULTATION_CATEGORY)) {
        categories.push({
          id: subList.id ?? '',
          title: subList.title,
          items: (subList.entry ?? []).map(e => itemFromRef(bundle, e.item)),
        })
        continue
      }
      // Sub-list that isn't a category — treat its items as direct
      if (subList) {
        for (const e of subList.entry ?? []) {
          items.push(itemFromRef(bundle, e.item))
        }
        continue
      }
    }
    // Direct clinical item
    items.push(itemFromRef(bundle, entry.item))
  }

  // Extension-CareConnect-RelatedProblemHeader-1 on the topic List itself —
  // files this topic under a Problem (confirmed real, EMIS-only so far,
  // Sep 2026). Shape: extension.extension[url=target].valueReference → Condition.
  const relatedProblemExt = getExtensionValue(topicList.extension, 'RelatedProblemHeader-1')
  const relatedProblemRef = (relatedProblemExt as unknown as { extension?: fhir3.Extension[] } | undefined)
    ?.extension?.find(e => e.url === 'target')?.valueReference?.reference
  const relatedProblemId = extractId(relatedProblemRef)
  const relatedProblemDisplay = relatedProblemRef ? resolveItemDisplay(bundle, relatedProblemRef) : undefined

  return {
    id: topicList.id ?? '',
    title: topicList.title,
    categories,
    items,
    relatedProblemId,
    relatedProblemDisplay,
  }
}

export function extractConsultations(bundle: fhir3.Bundle): GpConnectConsultation[] {
  const allLists = getEntries<fhir3.List>(bundle, 'List')

  return getEntries<fhir3.Encounter>(bundle, 'Encounter')
    .sort((a, b) => fhirDateKey(b.period?.start).localeCompare(fhirDateKey(a.period?.start)))
    .map(enc => {
    const period = enc.period

    const participants = enc.participant ?? []
    const hasType = (p: fhir3.EncounterParticipant, ...codes: string[]) =>
      (p.type ?? []).some(t => t.coding?.some(c => !!c.code && codes.includes(c.code)))
    // Performer (PPRF/PRF) and recorder (REC) can be different people — e.g.
    // one clinician sees the patient and another enters the record.
    const primary = participants.find(p => hasType(p, 'PPRF', 'PRF'))
      ?? participants.find(p => !hasType(p, 'REC'))
    const participantRef = (primary?.individual as fhir3.Reference | undefined)?.reference
    const { name: clinician, id: clinicianId } = resolvePractitionerRef(bundle, participantRef)
    const recorderParticipant = participants.find(p => hasType(p, 'REC'))
    const recorderRef = (recorderParticipant?.individual as fhir3.Reference | undefined)?.reference
    const { name: recorder, id: recorderId } = resolvePractitionerRef(bundle, recorderRef)

    const serviceProviderRef = (enc as unknown as { serviceProvider?: { reference?: string } })
      .serviceProvider?.reference
    const resolvedOrg = resolveReference(bundle, serviceProviderRef) as fhir3.Organization | undefined
    const organisation = resolvedOrg?.name ?? getOrganisationName(bundle)
    const organisationId = resolvedOrg?.id ?? extractId(serviceProviderRef)

    // Encounter.location[] — present in real data (confirmed Sep 2026: 100%
    // of real TPP Encounters, 13% of real EMIS ones) but was previously left
    // unextracted entirely.
    const locationRef = (enc as unknown as { location?: Array<{ location?: { reference?: string } }> })
      .location?.[0]?.location?.reference
    const resolvedLocation = resolveReference(bundle, locationRef) as { name?: string } | undefined
    const location = resolvedLocation?.name
    const locationId = extractId(locationRef)

    const typeEntry = enc.type?.[0]
    const type = extractOriginalTermText(typeEntry)

    const encCast = enc as unknown as { class?: { code?: string; display?: string }; status?: string }
    const encounterClass = encCast.class?.display ?? encCast.class?.code
    const encounterStatus = enc.status

    // Find the consultation wrapper list for this encounter
    const wrapperList = allLists.find(l =>
      hasCode(l, CONSULTATION_WRAPPER) && encRef(l)?.endsWith(`/${enc.id}`)
    )

    const topics: GpConnectConsultationTopic[] = []

    if (wrapperList) {
      for (const wEntry of wrapperList.entry ?? []) {
        const topicRef = wEntry.item.reference
        const topicList = allLists.find(l => l.id && topicRef?.endsWith(`/${l.id}`))
        if (!topicList) continue
        if (hasCode(topicList, CONSULTATION_TOPIC)) {
          topics.push(buildTopic(bundle, topicList, allLists))
        }
      }
    }

    return {
      id: enc.id ?? crypto.randomUUID(),
      date: formatDate(period?.start),
      endDate: formatDate(period?.end),
      type,
      clinician,
      clinicianId,
      recorder,
      recorderId,
      organisation,
      organisationId,
      location,
      locationId,
      encounterClass,
      encounterStatus,
      topics,
      notForPfs: hasNopatSecurity(enc),
    }
  })
}
