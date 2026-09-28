import type { GpConnectReferral, GpConnectReferralRecipient, GpConnectReferralDocument } from './types'
import { getEntries, formatDate, resolveReference, resolvePractitionerRef, extractOriginalTermText, extractId, fhirDateKey, hasNopatSecurity } from './utils'

function extractName(resource: Record<string, unknown>): string | undefined {
  const name = resource.name
  if (typeof name === 'string') return name
  if (Array.isArray(name) && name.length > 0) {
    const hn = name[0] as { text?: string; given?: string[]; family?: string; prefix?: string[] }
    return hn.text ?? [...(hn.prefix ?? []), ...(hn.given ?? []), hn.family].filter(Boolean).join(' ')
  }
  return undefined
}

function classifyResourceType(rt: string | undefined): GpConnectReferralRecipient['type'] {
  if (rt === 'Practitioner') return 'Practitioner'
  if (rt === 'HealthcareService') return 'HealthcareService'
  return 'Organisation'
}

export function extractReferrals(bundle: fhir3.Bundle): GpConnectReferral[] {
  return getEntries<fhir3.ReferralRequest>(bundle, 'ReferralRequest')
    .sort((a, b) => fhirDateKey(b.authoredOn).localeCompare(fhirDateKey(a.authoredOn)))
    .map(resource => {
    const cast = resource as unknown as Record<string, unknown>

    const recipientArr = Array.isArray(resource.recipient) ? resource.recipient : resource.recipient ? [resource.recipient] : []

    // Resolve all recipients, classifying each by resourceType
    const recipientRefs: GpConnectReferralRecipient[] = []
    for (const r of recipientArr) {
      const ref = (r as fhir3.Reference | undefined)?.reference
      const id = extractId(ref)
      if (!id || !ref) continue
      const resolved = resolveReference(bundle, ref) as Record<string, unknown> | undefined
      const type = classifyResourceType(resolved?.resourceType as string | undefined)
      const entry: GpConnectReferralRecipient = { id, type }
      if (resolved) entry.name = extractName(resolved)
      recipientRefs.push(entry)
    }

    // For display: prefer HealthcareService > Organisation > Practitioner
    const preferred = recipientRefs.find(r => r.type === 'HealthcareService')
      ?? recipientRefs.find(r => r.type === 'Organisation')
      ?? recipientRefs[0]

    const specialty = resource.specialty
    const recipient = preferred?.name ?? extractOriginalTermText(specialty)

    const reasonCode = resource.reasonCode?.[0]
    const reason = extractOriginalTermText(reasonCode)

    const requesterRef = (cast.requester as { agent?: fhir3.Reference } | undefined)?.agent?.reference
    const description = cast.description as string | undefined
    const { name: requester, id: requesterId } = resolvePractitionerRef(bundle, requesterRef)

    const supportingInfoRefs = (cast.supportingInfo as fhir3.Reference[] | undefined) ?? []
    const supportingDocs: GpConnectReferralDocument[] = []
    for (const ref of supportingInfoRefs) {
      const refStr = (ref as fhir3.Reference).reference
      if (!refStr?.startsWith('DocumentReference/')) continue
      const docId = extractId(refStr)
      if (!docId) continue
      const doc = resolveReference(bundle, refStr) as Record<string, unknown> | undefined
      if (!doc) continue
      const type = doc.type as fhir3.CodeableConcept | undefined
      const title = extractOriginalTermText(type) ?? 'Document'
      const entry: GpConnectReferralDocument = { id: docId, title }
      const docDesc = doc.description as string | undefined
      const created = doc.created as string | undefined
      const indexed = doc.indexed as string | undefined
      if (docDesc) entry.description = docDesc
      entry.date = formatDate(created ?? indexed)
      if (doc.status) entry.status = doc.status as string
      supportingDocs.push(entry)
    }

    return {
      id: resource.id ?? crypto.randomUUID(),
      date: formatDate(resource.authoredOn),
      recipient,
      recipientId: preferred?.id,
      recipientRefs,
      priority: resource.priority,
      reason,
      description: description || undefined,
      requester,
      requesterId,
      notes: (resource.note ?? []).map(n => n.text ?? '').filter(Boolean),
      status: resource.status ?? 'unknown',
      supportingDocs,
      notForPfs: hasNopatSecurity(resource),
    }
  })
}
