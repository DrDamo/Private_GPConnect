import type { DraftRecord } from '../types'
import type { TempIdMap } from '../idMap'
import { excludeConfidential, nopatMeta } from './security'

export function generateDiaryEntries(
  draft: DraftRecord,
  map: TempIdMap,
  patientRef: string,
): fhir3.BundleEntry[] {
  return excludeConfidential(draft.diaryEntries).map(entry => {
    const { id, fullUrl } = map.entry(entry._tempId)

    const hasPeriod = entry.occurrenceStart || entry.occurrenceEnd

    const resource: fhir3.ProcedureRequest = {
      resourceType: 'ProcedureRequest',
      id,
      ...nopatMeta(entry.notForPfs),
      status: (entry.status as fhir3.ProcedureRequest['status']) ?? 'active',
      intent: (entry.intent as fhir3.ProcedureRequest['intent']) ?? 'plan',
      subject: { reference: patientRef },
      code: {
        coding: [
          {
            system: 'http://snomed.info/sct',
            ...(entry.snomedCode ? { code: entry.snomedCode } : {}),
            ...(entry.description ? { display: entry.description } : {}),
          },
        ],
        ...(entry.description ? { text: entry.description } : {}),
      },
      ...(entry.clinicianTempId
        ? { requester: { agent: { reference: map.ref(entry.clinicianTempId, 'Practitioner') } } }
        : {}),
      ...(hasPeriod
        ? {
            occurrencePeriod: {
              ...(entry.occurrenceStart ? { start: entry.occurrenceStart } : {}),
              ...(entry.occurrenceEnd ? { end: entry.occurrenceEnd } : {}),
            },
          }
        : entry.date
          ? { occurrenceDateTime: entry.date }
          : {}),
      ...(entry.priority ? { priority: entry.priority } : {}),
      ...(entry.associatedText ? { note: [{ text: entry.associatedText }] } : {}),
    }

    return { fullUrl, resource }
  })
}
