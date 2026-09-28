import type { DraftRecord } from '../types'
import type { TempIdMap } from '../idMap'
import { excludeConfidential, nopatMeta } from './security'

export function generateReferrals(
  draft: DraftRecord,
  map: TempIdMap,
  patientRef: string,
): fhir3.BundleEntry[] {
  return excludeConfidential(draft.referrals).map(ref => {
    const { id, fullUrl } = map.entry(ref._tempId)

    const resource: fhir3.ReferralRequest = {
      resourceType: 'ReferralRequest',
      id,
      ...nopatMeta(ref.notForPfs),
      status: (ref.status as fhir3.ReferralRequest['status']) ?? 'active',
      intent: (ref.intent as fhir3.ReferralRequest['intent']) ?? 'order',
      subject: { reference: patientRef },
      ...(ref.priority ? { priority: ref.priority } : {}),
      ...(ref.date ? { authoredOn: ref.date } : {}),
      ...(ref.requesterTempId
        ? { requester: { agent: { reference: map.ref(ref.requesterTempId, 'Practitioner') } } }
        : {}),
      ...(ref.recipientName ? { recipient: [{ display: ref.recipientName }] } : {}),
      ...(ref.reason ? { reasonCode: [{ text: ref.reason }] } : {}),
      ...(ref.description ? { description: ref.description } : {}),
      ...(ref.associatedText ? { note: [{ text: ref.associatedText }] } : {}),
    }

    return { fullUrl, resource }
  })
}
