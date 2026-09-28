import type { DraftRecord } from '../types'
import type { TempIdMap } from '../idMap'
import { excludeConfidential, nopatMeta } from './security'

export function generateCodedData(
  draft: DraftRecord,
  map: TempIdMap,
  patientRef: string,
): fhir3.BundleEntry[] {
  return excludeConfidential(draft.codedData).map(item => {
    const { id, fullUrl } = map.entry(item._tempId)

    const hasUnit = Boolean(item.unit)
    const hasValue = item.value !== undefined && item.value !== ''

    const valueFields: Partial<fhir3.Observation> = hasValue
      ? hasUnit
        ? { valueQuantity: { value: parseFloat(item.value!), unit: item.unit } }
        : { valueString: item.value }
      : {}

    const resource: fhir3.Observation & { comment?: string } = {
      resourceType: 'Observation',
      id,
      ...nopatMeta(item.notForPfs),
      status: (item.status as fhir3.Observation['status']) ?? 'final',
      code: {
        coding: [
          {
            system: 'http://snomed.info/sct',
            ...(item.snomedCode ? { code: item.snomedCode } : {}),
            ...(item.description ? { display: item.description } : {}),
          },
        ],
        ...(item.description ? { text: item.description } : {}),
      },
      subject: { reference: patientRef },
      ...(item.date ? { effectiveDateTime: item.date } : {}),
      ...valueFields,
      ...(item.comment ? { comment: item.comment } : {}),
      ...(item.interpretation
        ? { interpretation: { coding: [{ display: item.interpretation }] } }
        : {}),
      ...(item.performerTempId
        ? { performer: [{ reference: map.ref(item.performerTempId, 'Practitioner') }] }
        : {}),
    }

    return { fullUrl, resource }
  })
}
