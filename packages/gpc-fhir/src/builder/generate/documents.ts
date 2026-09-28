import type { DraftRecord } from '../types'
import type { TempIdMap } from '../idMap'
import { excludeConfidential, nopatMeta } from './security'

export function generateDocuments(
  draft: DraftRecord,
  map: TempIdMap,
  patientRef: string,
): fhir3.BundleEntry[] {
  return excludeConfidential(draft.documents).map(doc => {
    const { id, fullUrl } = map.entry(doc._tempId)

    const attachment: fhir3.Attachment =
      doc.url || doc.mimeType
        ? {
            ...(doc.url ? { url: doc.url } : {}),
            ...(doc.mimeType ? { contentType: doc.mimeType } : {}),
          }
        : { title: doc.description ?? doc.type }

    const resource: fhir3.DocumentReference = {
      resourceType: 'DocumentReference',
      id,
      ...nopatMeta(doc.notForPfs),
      status: (doc.status as fhir3.DocumentReference['status']) ?? 'current',
      indexed: doc.indexedDate ?? new Date().toISOString(),
      ...(doc.type ? { type: { text: doc.type } } : { type: {} }),
      subject: { reference: patientRef },
      ...(doc.createdDate ? { created: doc.createdDate } : {}),
      ...(doc.description ? { description: doc.description } : {}),
      ...(doc.authorTempId
        ? { author: [{ reference: map.ref(doc.authorTempId, 'Practitioner') }] }
        : {}),
      ...(doc.custodianOrgTempId
        ? { custodian: { reference: map.ref(doc.custodianOrgTempId, 'Organization') } }
        : {}),
      content: [{ attachment }],
    }

    return { fullUrl, resource }
  })
}
