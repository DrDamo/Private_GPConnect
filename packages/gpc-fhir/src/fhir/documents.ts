import type { GpConnectDocument } from './types'
import { getEntries, formatDate, resolvePractitionerRef, resolveReference, extractOriginalTermText, extractId, fhirDateKey, hasNopatSecurity } from './utils'

export function extractDocuments(bundle: fhir3.Bundle): GpConnectDocument[] {
  return getEntries<fhir3.DocumentReference>(bundle, 'DocumentReference')
    .sort((a, b) => fhirDateKey(
      b.created ?? (b.content?.[0]?.attachment as any)?.creation
    ).localeCompare(fhirDateKey(
      a.created ?? (a.content?.[0]?.attachment as any)?.creation
    )))
    .map(resource => {
    const attachment = resource.content?.[0]?.attachment

    // Author may be a Practitioner or Organization reference
    const authorArr = Array.isArray(resource.author) ? resource.author : resource.author ? [resource.author] : []
    const authorRef = (authorArr[0] as fhir3.Reference | undefined)?.reference
    const { name: practitionerAuthor, id: authorId } = resolvePractitionerRef(bundle, authorRef)
    let author: string | undefined = practitionerAuthor
    if (!author && authorRef) {
      const authorResource = resolveReference(bundle, authorRef) as fhir3.Organization | undefined
      author = authorResource?.name
    }

    const custodianRef = (resource as unknown as { custodian?: fhir3.Reference }).custodian?.reference
    const custodianOrg = resolveReference(bundle, custodianRef) as fhir3.Organization | undefined
    const custodian = custodianOrg?.name
    const custodianId = custodianRef ? extractId(custodianRef) : undefined

    const attachmentSize = (attachment as unknown as { size?: number } | undefined)?.size
    const attachmentTitle = (attachment as unknown as { title?: string } | undefined)?.title
    const contextEncounterRef = (resource as unknown as { context?: { encounter?: { reference?: string } } }).context?.encounter?.reference
    const encounterId = contextEncounterRef ? extractId(contextEncounterRef) : undefined

    // Confirmed TPP-specific against a real bundle (Sep 2026) —
    // system https://tpp-uk.com/Id/document-master-identifier, absent in EMIS.
    const masterIdentifier = (resource as unknown as { masterIdentifier?: fhir3.Identifier }).masterIdentifier?.value

    return {
      id: resource.id ?? crypto.randomUUID(),
      date: formatDate(resource.created ?? attachment?.creation),
      type: extractOriginalTermText(resource.type) ?? 'Document',
      description: resource.description,
      attachmentTitle: attachmentTitle !== resource.description ? attachmentTitle : undefined,
      mimeType: attachment?.contentType,
      url: attachment?.url,
      author,
      authorId,
      encounterId,
      custodian,
      custodianId,
      status: resource.status ?? 'unknown',
      attachmentSize,
      masterIdentifier,
      notForPfs: hasNopatSecurity(resource),
    }
  })
}
