import type { GpConnectDiaryEntry, GpConnectDiaryNote } from './types'
import { getEntries, formatDate, resolvePractitionerRef, extractSnomedCode, extractOriginalTermText, extractId, fhirDateKey, hasNopatSecurity } from './utils'

export function extractDiaryEntries(bundle: fhir3.Bundle): GpConnectDiaryEntry[] {
  return getEntries<fhir3.ProcedureRequest>(bundle, 'ProcedureRequest')
    .sort((a, b) => fhirDateKey(
      b.authoredOn ?? (b as any).occurrenceDateTime ?? (b as any).occurrencePeriod?.start
    ).localeCompare(fhirDateKey(
      a.authoredOn ?? (a as any).occurrenceDateTime ?? (a as any).occurrencePeriod?.start
    )))
    .map(resource => {
    const req = resource as unknown as { requester?: { agent?: fhir3.Reference } }
    const cast = resource as unknown as Record<string, any>
    const coding = resource.code?.coding
    const { name: clinician, id: clinicianId } = resolvePractitionerRef(bundle, req.requester?.agent?.reference)
    const contextRef = (resource as unknown as { context?: { reference?: string } }).context?.reference
    const encounterId = extractId(contextRef)

    const occurrencePeriod = cast.occurrencePeriod as { start?: string; end?: string } | undefined
    const occurrenceStart = formatDate(occurrencePeriod?.start ?? cast.occurrenceDateTime)
    const occurrenceEnd = formatDate(occurrencePeriod?.end)

    const notes: GpConnectDiaryNote[] = (resource.note ?? [])
      .filter(n => n.text)
      .map(n => {
        const authorRef = (n as unknown as { authorReference?: fhir3.Reference }).authorReference?.reference
        const { name: author, id: authorId } = resolvePractitionerRef(bundle, authorRef)
        return {
          text: n.text!,
          author: author ?? undefined,
          authorId: authorId ?? undefined,
          time: formatDate((n as unknown as { time?: string }).time),
        }
      })

    return {
      id: resource.id ?? crypto.randomUUID(),
      date: formatDate(resource.authoredOn ?? cast.occurrenceDateTime ?? occurrencePeriod?.start),
      description: extractOriginalTermText(resource.code) ?? 'Unknown',
      snomedCode: extractSnomedCode(coding),
      clinician,
      clinicianId,
      encounterId,
      priority: resource.priority,
      status: resource.status ?? 'unknown',
      intent: cast.intent as string | undefined,
      occurrenceStart,
      occurrenceEnd,
      notes,
      notForPfs: hasNopatSecurity(resource),
    }
  })
}
