import type * as fhir3 from 'fhir/r3'
import type { GpConnectList, GpConnectListEntry, ListCategory } from './types'
import { getEntries, resolveItemDisplay, extractOriginalTermText, extractId, fhirDateKey, hasNopatSecurity } from './utils'
import { titleIndexKey } from './lineIndex'

const PRIMARY_LIST_CODES = new Set([
  '1149501000000101', // List of consultations
  '886921000000105',  // Allergies and adverse reactions
  '1103671000000101', // Ended allergies
  '933361000000108',  // Medications and medical devices
  '1102181000000102', // Immunisations
  '887191000000108',  // Investigations and results
  '717711000000103',  // Problems
  '792931000000107',  // Outbound referral
  '714311000000108',  // Patient recall administration (diary entries)
  '826501000000100',  // Miscellaneous record (uncategorised data)
])

const SECONDARY_LIST_SYSTEM = 'https://fhir.hl7.org.uk/STU3/CodeSystem/GPConnect-SecondaryListValues-1'

function classifyList(list: fhir3.List): ListCategory {
  const coding = list.code?.coding?.[0]
  if (!coding) return 'other'

  if (coding.system === SECONDARY_LIST_SYSTEM) {
    const code = coding.code ?? ''
    if (code.startsWith('consultations-')) return 'secondary-consultation'
    if (code.startsWith('problems-')) return 'secondary-problems'
    return 'other'
  }

  const code = coding.code ?? ''
  if (code === '325851000000107') return 'consultation-wrapper'
  if (code === '25851000000105') return 'consultation-topic'
  if (code === '24781000000107') return 'consultation-category'
  if (PRIMARY_LIST_CODES.has(code)) return 'primary'

  // Encounter-linked lists that don't match known codes are still internal
  if ((list as unknown as { encounter?: { reference?: string } }).encounter?.reference) {
    return 'consultation-topic'
  }

  return 'other'
}

// Internal lists belong to consultation structure — exclude from the Lists tab
const INTERNAL_CATEGORIES = new Set<ListCategory>([
  'consultation-wrapper',
  'consultation-topic',
  'consultation-category',
])

export function extractLists(bundle: fhir3.Bundle): GpConnectList[] {
  return getEntries<fhir3.List>(bundle, 'List')
    .sort((a, b) => fhirDateKey(b.date).localeCompare(fhirDateKey(a.date)))
    .map(list => {
      const category = classifyList(list)
      const encounterId = extractId(
        (list as unknown as { encounter?: { reference?: string } }).encounter?.reference
      )

      const title = list.title ?? extractOriginalTermText(list.code)
      const orderedBy = extractOriginalTermText(list.orderedBy)
      const emptyReason = extractOriginalTermText(list.emptyReason)
      const note = list.note?.map(n => n.text).filter(Boolean).join('; ') || undefined
      const listCode = list.code?.coding?.[0]?.code
      const warningExt = (list.extension ?? []).find(e =>
        e.url?.includes('Extension-CareConnect-GPC-ListWarningCode-1')
      )
      const warningCode = (warningExt as { valueCode?: string } | undefined)?.valueCode

      const entries: GpConnectListEntry[] = (list.entry ?? []).map(e => {
        const ref = e.item.reference
        // Local contained references (#id) need special handling
        const isLocal = ref?.startsWith('#') ?? false
        const localId = isLocal ? ref!.slice(1) : undefined
        const resourceId = isLocal ? (localId ?? '') : (extractId(ref) ?? '')
        const resolved = isLocal ? resolveItemDisplay(bundle, ref) : undefined
        const containedResource = isLocal
          ? (list as unknown as { contained?: fhir3.Resource[] }).contained?.find(c => c.id === localId)
          : undefined
        const resourceType = isLocal
          ? ((containedResource as unknown as { resourceType?: string })?.resourceType ?? '')
          : (ref?.split('/')[0] ?? '')
        const display = e.item.display ?? (isLocal ? resolved : resolveItemDisplay(bundle, ref))
        const flag = extractOriginalTermText(e.flag)

        return {
          resourceId,
          resourceType,
          display,
          date: e.date,
          flag,
          deleted: e.deleted === true,
        }
      })

      return {
        id: list.id ?? (list.title ? titleIndexKey(list.title) : crypto.randomUUID()),
        title,
        status: list.status ?? 'unknown',
        mode: list.mode,
        date: list.date,
        orderedBy,
        note,
        emptyReason,
        entries,
        category,
        encounterId,
        listCode,
        warningCode,
        notForPfs: hasNopatSecurity(list),
      }
    })
    .filter(l => !INTERNAL_CATEGORIES.has(l.category))
}
