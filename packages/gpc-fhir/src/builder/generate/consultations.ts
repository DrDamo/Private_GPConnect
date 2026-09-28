import type { DraftRecord, DraftConsultation, DraftConsultationItem, ConsultationLinkKind } from '../types'
import type { TempIdMap } from '../idMap'
import { excludeConfidential, nopatMeta } from './security'

const SNOMED = 'http://snomed.info/sct'
const COMMENT_NOTE_CODE = '37331000000100'
const CONSULTATION_WRAPPER_CODE = '325851000000107'
const CONSULTATION_TOPIC_CODE = '25851000000105'
const CONSULTATION_CATEGORY_CODE = '24781000000107'

// Resource type each linked-category kind resolves to, for building the
// category List's entry references (see DraftConsultationCategory.linkedRefs).
const LINK_KIND_RESOURCE_TYPE: Record<ConsultationLinkKind, string> = {
  allergy: 'AllergyIntolerance',
  document: 'DocumentReference',
  investigation: 'DiagnosticReport',
  diaryEntry: 'ProcedureRequest',
  medication: 'MedicationStatement',
  referral: 'ReferralRequest',
}

function makeListBase(
  id: string,
  patientRef: string,
  date: string | undefined,
  encRef: string,
  code: string,
  display: string,
  title: string | undefined,
  itemRefs: string[],
): fhir3.List {
  const list: fhir3.List = {
    resourceType: 'List',
    id,
    status: 'current',
    mode: 'snapshot',
    code: {
      coding: [{ system: SNOMED, code, display }],
    },
    subject: { reference: patientRef },
    date: date ?? new Date().toISOString(),
    // FHIR forbids an empty array where one is present at all — every caller
    // here is expected to have already skipped List generation when there's
    // nothing to reference, but this is the last line of defence against
    // ever emitting the structurally-invalid `"entry": []`.
    ...(itemRefs.length > 0 ? { entry: itemRefs.map(ref => ({ item: { reference: ref } })) } : {}),
  }
  if (title) list.title = title
  // encounter is a GP Connect extension field not in base fhir3.List type
  ;(list as unknown as Record<string, unknown>)['encounter'] = { reference: encRef }
  return list
}

function makeNoteObservation(
  id: string,
  fullUrl: string,
  patientRef: string,
  encRef: string,
  item: DraftConsultationItem,
): fhir3.BundleEntry {
  const resource: fhir3.Observation & { comment?: string } = {
    resourceType: 'Observation',
    id,
    status: 'final',
    code: {
      coding: [{ system: SNOMED, code: COMMENT_NOTE_CODE, display: 'Comment note' }],
    },
    subject: { reference: patientRef },
    ...(item.date ? { effectiveDateTime: item.date } : {}),
    comment: item.narrativeText,
  }
  // context is a STU3 field for encounter reference
  ;(resource as unknown as Record<string, unknown>)['context'] = { reference: encRef }
  return { fullUrl, resource }
}

const OBSERVABLE_ENTITY_TAG = 'observable entity'

// Standard HL7 v3 interpretation codes exist for Normal/Abnormal; "Potentially
// Abnormal" isn't a standard code, so it's sent as text only rather than
// guessing a code that might not be right.
const INTERPRETATION_CODING: Partial<Record<NonNullable<DraftConsultationItem['interpretation']>, { code: string; display: string }>> = {
  normal: { code: 'N', display: 'Normal' },
  abnormal: { code: 'A', display: 'Abnormal' },
}

function toNumber(s: string | undefined): number | undefined {
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function makeCodedObservation(
  id: string,
  fullUrl: string,
  patientRef: string,
  encRef: string,
  item: DraftConsultationItem,
): fhir3.BundleEntry {
  // Value/units/range/interpretation only apply to Observable Entity concepts
  // — everything else is a coded finding/procedure/etc. with no measurement.
  const isObservable = item.semanticTag === OBSERVABLE_ENTITY_TAG
  const numericValue = isObservable ? toNumber(item.value) : undefined
  const minValue = isObservable ? toNumber(item.minRange) : undefined
  const maxValue = isObservable ? toNumber(item.maxRange) : undefined
  const interpretation = isObservable ? item.interpretation : undefined

  const resource: fhir3.Observation & { comment?: string } = {
    resourceType: 'Observation',
    id,
    status: 'final',
    code: {
      coding: [
        {
          system: SNOMED,
          ...(item.snomedCode ? { code: item.snomedCode } : {}),
          ...(item.description ? { display: item.description } : {}),
        },
      ],
      ...(item.description ? { text: item.description } : {}),
    },
    subject: { reference: patientRef },
    ...(item.date ? { effectiveDateTime: item.date } : {}),
    ...(numericValue !== undefined
      ? { valueQuantity: { value: numericValue, ...(item.unit ? { unit: item.unit } : {}) } }
      : item.value ? { valueString: item.value } : {}),
    ...(isObservable && (minValue !== undefined || maxValue !== undefined)
      ? {
          referenceRange: [{
            ...(minValue !== undefined ? { low: { value: minValue, ...(item.unit ? { unit: item.unit } : {}) } } : {}),
            ...(maxValue !== undefined ? { high: { value: maxValue, ...(item.unit ? { unit: item.unit } : {}) } } : {}),
          }],
        }
      : {}),
    ...(interpretation
      ? {
          interpretation: INTERPRETATION_CODING[interpretation]
            ? {
                coding: [{ system: 'http://hl7.org/fhir/v3/ObservationInterpretation', ...INTERPRETATION_CODING[interpretation] }],
                text: INTERPRETATION_CODING[interpretation]!.display,
              }
            : { text: 'Potentially Abnormal' },
        }
      : {}),
    ...(item.associatedText ? { comment: item.associatedText } : {}),
  }
  ;(resource as unknown as Record<string, unknown>)['context'] = { reference: encRef }
  return { fullUrl, resource }
}

// Every category (default History/Examination/Assessment/Plan included) and
// every "+ Add item" click seeds a blank item — a note with no narrative
// text, or a coded entry with nothing picked — so item count alone doesn't
// tell you whether a category has anything actually recorded in it. This is
// what "empty" means for filtering purposes.
function isItemEmpty(item: DraftConsultationItem): boolean {
  if (item.itemType === 'coded') return !item.snomedCode && !item.description
  return !item.narrativeText
}

function processItem(
  item: DraftConsultationItem,
  map: TempIdMap,
  patientRef: string,
  encRef: string,
  extraEntries: fhir3.BundleEntry[],
): string {
  if (item.itemType === 'note') {
    const { id, fullUrl } = map.entry(item._tempId)
    extraEntries.push(makeNoteObservation(id, fullUrl, patientRef, encRef, item))
    return `Observation/${id}`
  }

  if (item.itemType === 'coded') {
    const { id, fullUrl } = map.entry(item._tempId)
    extraEntries.push(makeCodedObservation(id, fullUrl, patientRef, encRef, item))
    return `Observation/${id}`
  }

  // fallback: treat as note
  const { id, fullUrl } = map.entry(item._tempId)
  extraEntries.push(makeNoteObservation(id, fullUrl, patientRef, encRef, item))
  return `Observation/${id}`
}

function makeEncounter(
  draft: DraftConsultation,
  map: TempIdMap,
  patientRef: string,
  orgRef: string,
): { entry: fhir3.BundleEntry; id: string; ref: string } {
  const { id, fullUrl } = map.entry(draft._tempId)

  const encounterClass: fhir3.Coding = {
    system: 'http://hl7.org/fhir/v3/ActCode',
    code: draft.encounterClass ?? 'AMB',
    display: draft.encounterClass === 'HH' ? 'home health' : 'ambulatory',
  }

  const resource: fhir3.Encounter = {
    resourceType: 'Encounter',
    id,
    ...nopatMeta(draft.notForPfs),
    status: 'finished',
    class: encounterClass,
    // type[] carries a single plain-text entry — confirmed against a real
    // GP Connect Encounter (TPP): { "type": [{ "text": "Clinical" }] }, no
    // coding, no dedicated codesystem. The text value itself isn't fixed by
    // the spec, so it's set to whatever consultation type the user picked
    // (e.g. "Face-to-face encounter") rather than a hardcoded marker.
    type: [{ text: draft.typeDisplay ?? 'Clinical' }],
    subject: { reference: patientRef },
    period: {
      ...(draft.date ? { start: draft.date } : {}),
      end: draft.endDate ?? draft.date,
    },
    ...(draft.clinicianTempId
      ? {
          participant: [
            {
              type: [
                {
                  coding: [
                    {
                      system: 'http://hl7.org/fhir/v3/ParticipationType',
                      code: 'PPRF',
                      display: 'primary performer',
                    },
                  ],
                },
              ],
              individual: { reference: map.ref(draft.clinicianTempId, 'Practitioner') },
            },
          ],
        }
      : {}),
    serviceProvider: { reference: orgRef },
  }

  return { entry: { fullUrl, resource }, id, ref: `Encounter/${id}` }
}

function processConsultation(
  draft: DraftConsultation,
  map: TempIdMap,
  patientRef: string,
  orgRef: string,
): fhir3.BundleEntry[] {
  const entries: fhir3.BundleEntry[] = []

  const { entry: encEntry, ref: encRef } = makeEncounter(draft, map, patientRef, orgRef)
  entries.push(encEntry)

  const topicListRefs: string[] = []

  for (const topic of draft.topics) {
    const categoryListRefs: string[] = []

    for (const cat of topic.categories) {
      const catItems = cat.items.filter(item => !isItemEmpty(item))

      // A category with nothing actually recorded — no filled-in items and
      // no linked records (e.g. a default "History" left untouched) — has
      // nothing to file. Skip it rather than emitting an empty List.
      const isEmptyCategory = catItems.length === 0 && (cat.linkedRefs ?? []).length === 0
      if (isEmptyCategory) continue

      const catItemRefs: string[] = []

      for (const item of catItems) {
        catItemRefs.push(processItem(item, map, patientRef, encRef, entries))
      }
      // A linked-kind category (Allergy/Document/Investigation/Diary Entry/
      // Medication/Referral) has no items of its own — its content is these
      // references to records created in their own top-level section.
      for (const linked of cat.linkedRefs ?? []) {
        catItemRefs.push(map.ref(linked.tempId, LINK_KIND_RESOURCE_TYPE[linked.kind]))
      }

      const catListId = map.resolve(cat._tempId)
      const catList = makeListBase(
        catListId,
        patientRef,
        draft.date,
        encRef,
        CONSULTATION_CATEGORY_CODE,
        'Consultation category',
        cat.title,
        catItemRefs,
      )
      entries.push({ fullUrl: `urn:uuid:${catListId}`, resource: catList })
      categoryListRefs.push(`List/${catListId}`)
    }

    // Direct topic items (not in a category)
    const directItemRefs: string[] = []
    for (const item of topic.items.filter(item => !isItemEmpty(item))) {
      directItemRefs.push(processItem(item, map, patientRef, encRef, entries))
    }

    // A topic with no non-empty categories and no direct items has nothing
    // to file either — skip it rather than emitting an empty List.
    const isEmptyTopic = categoryListRefs.length === 0 && directItemRefs.length === 0
    if (isEmptyTopic) continue

    const topicListId = map.resolve(topic._tempId)
    const topicList = makeListBase(
      topicListId,
      patientRef,
      draft.date,
      encRef,
      CONSULTATION_TOPIC_CODE,
      'Consultation topic',
      topic.title,
      [...categoryListRefs, ...directItemRefs],
    )
    entries.push({ fullUrl: `urn:uuid:${topicListId}`, resource: topicList })
    topicListRefs.push(`List/${topicListId}`)
  }

  // A consultation with no non-empty topics has nothing to wrap — skip the
  // top-level "Consultation" List rather than emitting one with no entries
  // (same rule as categories/topics above; also avoids the structurally
  // invalid `"entry": []` a wrapper with nothing to reference would produce).
  if (topicListRefs.length > 0) {
    const wrapperListId = crypto.randomUUID()
    const wrapperList = makeListBase(
      wrapperListId,
      patientRef,
      draft.date,
      encRef,
      CONSULTATION_WRAPPER_CODE,
      'Consultation',
      undefined,
      topicListRefs,
    )
    entries.push({ fullUrl: `urn:uuid:${wrapperListId}`, resource: wrapperList })
  }

  return entries
}

export function generateConsultations(
  draft: DraftRecord,
  map: TempIdMap,
  patientRef: string,
): fhir3.BundleEntry[] {
  const orgRef = map.ref(draft.organisation._tempId, 'Organization')
  return excludeConfidential(draft.consultations).flatMap(c => processConsultation(c, map, patientRef, orgRef))
}
