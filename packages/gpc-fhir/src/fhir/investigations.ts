import type { GpConnectInvestigation, GpConnectInvestigationResult, GpConnectTestGroup, GpConnectObservationComponent, GpConnectSpecimen, GpConnectProcedureRequest } from './types'
import { getEntries, formatDate, resolvePractitionerRef, resolvePractitionerName, resolveReference, extractSnomedCode, extractOriginalTermText, extractId, fhirDateKey, hasNopatSecurity, getExtensionValue } from './utils'

const PERFORMER_ACTOR_TYPE: Record<string, 'Practitioner' | 'Organisation' | 'HealthcareService'> = {
  Practitioner: 'Practitioner',
  Organization: 'Organisation',
  HealthcareService: 'HealthcareService',
}

// Resolves a single DiagnosticReport.performer[].actor (or an Observation.performer[]
// fallback) — these can be a Practitioner, Organization, or HealthcareService.
function resolvePerformerActor(
  bundle: fhir3.Bundle,
  ref: string | undefined,
  display: string | undefined
): { type: 'Practitioner' | 'Organisation' | 'HealthcareService'; id: string; name?: string } | undefined {
  if (!ref) return undefined
  const type = PERFORMER_ACTOR_TYPE[ref.split('/')[0]]
  const id = extractId(ref)
  if (!type || !id) return undefined
  const name = type === 'Practitioner'
    ? resolvePractitionerName(bundle, ref) || display
    : (resolveReference(bundle, ref) as { name?: string } | undefined)?.name || display
  return { type, id, name }
}

type ObsLike = fhir3.Observation & {
  comment?: string
  component?: Array<{
    code?: fhir3.CodeableConcept
    valueQuantity?: fhir3.Quantity
    valueString?: string
    referenceRange?: Array<{ low?: fhir3.Quantity; high?: fhir3.Quantity }>
    interpretation?: fhir3.CodeableConcept
  }>
}

// SNOMED codes with special handling in DiagnosticReport.result[]
const GROUP_HEADER_CODE = '364712009'   // Laboratory test observable (TPP explicit group marker)
const COMMENT_NOTE_CODE = '37331000000100'  // Comment note / filing comment
const SKIP_CODE = '24641000000107'  // Investigation result placeholder — skip
const TRANSFER_DEGRADED_CODE = '196411000000103'  // Transfer-degraded record entry

const INTERP_CODE_DISPLAY: Record<string, string> = {
  H:  'Above high reference limit',
  HH: 'Critically high',
  L:  'Below low reference limit',
  LL: 'Critically low',
  N:  'Normal',
  A:  'Abnormal',
  AA: 'Critically abnormal',
  PA: 'Potentially abnormal',
  U:  'Unknown',
}

// Normalises interpretation from FHIR CodeableConcept + optional raw comment.
// Priority: text (stripping "XX - " prefix) → coding display → code map → TPP comment.
function normalizeInterpretation(interp: fhir3.CodeableConcept | undefined, rawComment?: string): string | undefined {
  if (interp?.text) {
    // Strip leading code prefix e.g. "PA - ", "HI - ", "LO - "
    const stripped = interp.text.replace(/^[A-Za-z]{1,3}\s*-\s+/i, '').trim()
    return stripped || interp.text.trim()
  }
  const coding = interp?.coding?.[0]
  if (coding?.display) return coding.display
  const code = coding?.code?.toUpperCase()
  if (code) return INTERP_CODE_DISPLAY[code] ?? code
  // TPP fallback: interpretation buried in comment as "Interpretation Code: X"
  if (rawComment) {
    const m = rawComment.match(/^Interpretation Code:\s*([^\n\r]+)/im)
    if (m) return m[1].trim()
  }
  return undefined
}

function resolveSpecimen(bundle: fhir3.Bundle, ref: string | undefined): GpConnectSpecimen | undefined {
  if (!ref) return undefined
  const spec = resolveReference(bundle, ref) as (fhir3.Resource & {
    type?: { text?: string; coding?: Array<{ display?: string; code?: string; system?: string }> }
    status?: string
    collection?: { collectedDateTime?: string }
    receivedTime?: string
    note?: Array<{ text?: string }>
  }) | undefined
  if (!spec) return undefined
  return {
    id: spec.id ?? '',
    type: extractOriginalTermText(spec.type),
    typeCode: spec.type?.coding?.find(c => c.system === 'http://snomed.info/sct')?.code ?? spec.type?.coding?.[0]?.code,
    collectedDateTime: formatDate(spec.collection?.collectedDateTime),
    receivedTime: formatDate(spec.receivedTime),
    status: spec.status,
    note: spec.note?.map(n => n.text).filter((t): t is string => !!t).join('\n\n') || undefined,
  }
}

function formatRange(rr: fhir3.ObservationReferenceRange | undefined): string | undefined {
  if (!rr) return undefined
  const low = rr.low?.value !== undefined ? String(rr.low.value) : undefined
  const high = rr.high?.value !== undefined ? String(rr.high.value) : undefined
  const unit = rr.low?.unit ?? rr.high?.unit
  if (low !== undefined && high !== undefined) return `${low}–${high}${unit ? ` ${unit}` : ''}`
  if (low !== undefined) return `>${low}${unit ? ` ${unit}` : ''}`
  if (high !== undefined) return `<${high}${unit ? ` ${unit}` : ''}`
  return rr.text
}

// Parse structured values from TPP-style comment text (when no valueQuantity is present)
function parseCommentValue(comment: string): {
  value?: string; unit?: string; referenceRange?: string; interpretation?: string
} {
  const out: { value?: string; unit?: string; referenceRange?: string; interpretation?: string } = {}
  const valMatch = comment.match(/^Value:\s+([^\n\r]+)/m)
  if (valMatch) {
    const raw = valMatch[1].trim()
    const numMatch = raw.match(/^(-?\d+\.?\d*(?:[eE][+-]?\d+)?)\s+(.+)$/)
    if (numMatch) {
      out.value = numMatch[1]
      out.unit = numMatch[2]
    } else {
      out.value = raw
    }
  }
  const rangeMatch = comment.match(/^Reference range:\s+([^\n\r]+)/m)
  if (rangeMatch) {
    out.referenceRange = rangeMatch[1].trim().replace(/\s*-\s*/, '–')
  }
  const interpMatch = comment.match(/^Interpretation Code:\s+([^\n\r]+)/m)
  if (interpMatch) {
    out.interpretation = interpMatch[1].trim()
  }
  return out
}

// Strip parsed/redundant lines from a result comment; return narrative-only text
function cleanResultComment(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const cleaned = raw
    .replace(/^Value:[^\n]*/gm, '')
    .replace(/^Reference range:[^\n]*/gm, '')
    .replace(/^Interpretation Code:[^\n]*/gm, '')
    .replace(/^Original text:[^\n]*/gm, '')  // redundant: duplicates result name
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join('\n')
  return cleaned || undefined
}

// Strip "Original text: {name}\n\n" prefix from TPP group header comments
function cleanGroupComment(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const stripped = raw
    .replace(/^Original text:[^\n]*\n\n?/, '')
    .replace(/\r/g, '')
    .trim()
  return stripped || undefined
}

// Resolve a better name for TPP's generic "Laboratory procedures" group header,
// and for transfer-degraded observations whose original text is in the comment.
const GENERIC_GROUP_NAMES = new Set(['Laboratory procedures', 'Laboratory test observable'])

function originalTextFromComment(obs: ObsLike): string | undefined {
  if (!obs.comment) return undefined
  const m = obs.comment.match(/^Original text:\s*([^\n\r]+)/im)
  return m ? m[1].trim() : undefined
}

function groupHeaderName(obs: ObsLike): string {
  const coding = obs.code?.coding
  const codeText = obs.code?.text
  const displayName = coding?.[0]?.display ?? ''
  const isGeneric = GENERIC_GROUP_NAMES.has(codeText ?? displayName)
  const isTransferDegraded = !codeText && coding?.some(c => c.code === TRANSFER_DEGRADED_CODE)
  if (isGeneric || isTransferDegraded) {
    const original = originalTextFromComment(obs)
    if (original) return original
  }
  return codeText ?? (displayName || 'Results')
}

function resolveObsName(obs: ObsLike, fallback: string): string {
  const codeText = obs.code?.text
  if (!codeText && obs.code?.coding?.some(c => c.code === TRANSFER_DEGRADED_CODE)) {
    const original = originalTextFromComment(obs)
    if (original) return original
  }
  return extractOriginalTermText(obs.code) ?? fallback
}

function isTransferDegradedObs(obs: ObsLike): boolean {
  if (!obs.code?.coding?.some(c => c.code === TRANSFER_DEGRADED_CODE)) return false
  return !!obs.code?.text || !!originalTextFromComment(obs)
}

function obsHasValue(obs: ObsLike): boolean {
  const cast = obs as unknown as { valueString?: string }
  return obs.valueQuantity?.value !== undefined || !!cast.valueString || !!obs.valueCodeableConcept
}

function extractObsResult(obs: ObsLike): Pick<GpConnectInvestigationResult,
  'value' | 'unit' | 'referenceRange' | 'interpretation' | 'comment' | 'components' | 'isApproximate'> {
  const vq = obs.valueQuantity
  const cast = obs as unknown as { valueString?: string }
  let value: string | undefined = vq?.value !== undefined
    ? String(vq.value)
    : cast.valueString ?? extractOriginalTermText(obs.valueCodeableConcept)
  let unit = vq?.unit
  let referenceRange = formatRange(obs.referenceRange?.[0])
  let interpretation = extractOriginalTermText(obs.interpretation)
  // Extension-CareConnect-ValueApproximation-1 (valueBoolean) — flags an
  // estimated/approximate result. Confirmed against a real TPP bundle
  // (Sep 2026); not yet observed from EMIS.
  const isApproximate = getExtensionValue(vq?.extension, 'ValueApproximation-1')?.valueBoolean === true

  const rawComment = obs.comment || undefined
  if (!value && rawComment) {
    const parsed = parseCommentValue(rawComment)
    if (parsed.value) { value = parsed.value; unit = unit ?? parsed.unit }
    referenceRange = referenceRange ?? parsed.referenceRange
    interpretation = interpretation ?? parsed.interpretation
  }

  const comment = cleanResultComment(rawComment)

  const components: GpConnectObservationComponent[] | undefined = obs.component?.length
    ? obs.component.map(c => ({
        name: extractOriginalTermText(c.code) ?? 'Component',
        value: c.valueQuantity?.value !== undefined ? String(c.valueQuantity.value) : c.valueString,
        unit: c.valueQuantity?.unit,
        referenceRange: formatRange(c.referenceRange?.[0]),
        interpretation: extractOriginalTermText(c.interpretation),
      }))
    : undefined

  return { value, unit, referenceRange, interpretation, comment, components, isApproximate: isApproximate || undefined }
}

export function extractInvestigations(bundle: fhir3.Bundle): GpConnectInvestigation[] {
  return getEntries<fhir3.DiagnosticReport>(bundle, 'DiagnosticReport')
    .sort((a, b) => fhirDateKey(
      (b as unknown as { effectiveDateTime?: string }).effectiveDateTime ?? b.issued
    ).localeCompare(fhirDateKey(
      (a as unknown as { effectiveDateTime?: string }).effectiveDateTime ?? a.issued
    )))
    .map(report => {
      const castReport = report as unknown as Record<string, string>
      const reportId = report.id ?? crypto.randomUUID()

      // DiagnosticReport.performer[] can list several actors mixing Organizations,
      // Practitioners, and HealthcareServices (e.g. the reporting lab, an interpreting
      // practitioner, and a referring practice) — capture all of them, not just the first,
      // so every one of them can be shown (and jumped to) as a referenced resource.
      const performerActors: Array<{ type: 'Practitioner' | 'Organisation' | 'HealthcareService'; id: string; name?: string }> = []
      for (const p of (report.performer ?? []) as Array<{ actor?: { reference?: string; display?: string } }>) {
        const resolved = resolvePerformerActor(bundle, p.actor?.reference, p.actor?.display)
        if (resolved) performerActors.push(resolved)
      }

      let performer: string | undefined = performerActors[0]?.name
      let performerId: string | undefined = performerActors[0]?.id

      // Fallback: if DiagnosticReport carries no performer, take it from the first result Observation
      if (!performer) {
        const firstResultRef = ((report.result ?? []) as fhir3.Reference[])[0]
        if (firstResultRef?.reference) {
          const firstObs = resolveReference(bundle, firstResultRef.reference) as ObsLike | undefined
          const obsPerf = (firstObs?.performer as Array<{ reference?: string; display?: string } | undefined> | undefined)?.[0]
          const resolved = resolvePerformerActor(bundle, obsPerf?.reference, obsPerf?.display)
          if (resolved) {
            performerActors.push(resolved)
            performer = resolved.name
            performerId = resolved.id
          } else {
            performer = obsPerf?.display
          }
        }
      }

      const performers = performerActors.length > 0
        ? performerActors.map(({ type, id }) => ({ type, id }))
        : undefined

      // DiagnosticReport.specimen[] — a report can reference several specimens (e.g. one
      // per test group: serum for renal/lipids, fluoride oxalate for glucose, EDTA for FBC).
      // Falls back to this DR-level list only when a result observation doesn't carry its
      // own specimen reference (common when the report has just one specimen overall).
      const drSpecimenRefs = (report as unknown as { specimen?: Array<{ reference?: string }> }).specimen ?? []
      const drFallbackSpecimen = drSpecimenRefs.length === 1
        ? resolveSpecimen(bundle, drSpecimenRefs[0].reference)
        : undefined

      // Resolves the specimen for a given result/group-header observation, falling back to
      // the DR-level specimen only when the report references exactly one specimen overall.
      const obsSpecimen = (obs: ObsLike): GpConnectSpecimen | undefined => {
        const ref = (obs as unknown as { specimen?: { reference?: string } }).specimen?.reference
        return resolveSpecimen(bundle, ref) ?? drFallbackSpecimen
      }

      // Resolve ProcedureRequest from DiagnosticReport.basedOn
      let procedureRequest: GpConnectProcedureRequest | undefined
      const basedOnRefs = (report as unknown as { basedOn?: Array<{ reference?: string }> }).basedOn ?? []
      const prRef = basedOnRefs.find(r => r.reference?.includes('ProcedureRequest/'))?.reference
      if (prRef) {
        const pr = resolveReference(bundle, prRef) as (fhir3.Resource & {
          code?: fhir3.CodeableConcept
          status?: string
          intent?: string
          requester?: { agent?: { reference?: string; display?: string } }
          performer?: { reference?: string; display?: string }
          note?: Array<{ text?: string }>
        }) | undefined
        if (pr) {
          const prCoding = pr.code?.coding
          const reqAgentRef = pr.requester?.agent?.reference
          const reqAgentDisplay = pr.requester?.agent?.display
          let requester: string | undefined
          let requesterId: string | undefined
          if (reqAgentRef?.startsWith('Practitioner/')) {
            const resolved = resolvePractitionerRef(bundle, reqAgentRef)
            requester = resolved.name || reqAgentDisplay
            requesterId = resolved.id
          } else {
            requester = reqAgentDisplay
          }
          const perfRef = pr.performer?.reference
          const perfDisplay = pr.performer?.display
          let prPerformer: string | undefined
          let prPerformerId: string | undefined
          if (perfRef?.startsWith('Practitioner/')) {
            const resolved = resolvePractitionerRef(bundle, perfRef)
            prPerformer = resolved.name || perfDisplay
            prPerformerId = resolved.id
          } else if (perfRef) {
            const resolvedOrg = resolveReference(bundle, perfRef) as fhir3.Organization | undefined
            prPerformer = resolvedOrg?.name || perfDisplay
          } else {
            prPerformer = perfDisplay
          }
          procedureRequest = {
            id: pr.id ?? '',
            name: extractOriginalTermText(pr.code),
            snomedCode: extractSnomedCode(prCoding),
            status: pr.status,
            intent: pr.intent,
            requester,
            requesterId,
            performer: prPerformer,
            performerId: prPerformerId,
            notes: pr.note?.map(n => n.text ?? '').filter(Boolean) as string[] | undefined,
          }
        }
      }

      const contextRef = (report as unknown as { context?: { reference?: string } }).context?.reference
      const encounterId = extractId(contextRef)

      // Resolve all result observations, preserving order
      const resultObs: ObsLike[] = []
      for (const ref of (report.result ?? []) as fhir3.Reference[]) {
        const obs = resolveReference(bundle, ref.reference) as ObsLike | undefined
        if (obs) resultObs.push(obs)
      }

      // Separate filing comment (37331000000100) from lab observations.
      // COMM notes that carry a derived-from reference to a sibling result are per-result
      // comments (e.g. EMIS attaches a brief flag text "High"/"Low" to individual analytes).
      // Only COMM notes without a derived-from link are panel-level filing comments.
      let filingComment: string | undefined
      let filingCommentDate: string | undefined
      let filingCommentPerformer: string | undefined
      const labObs: ObsLike[] = []
      // Maps parent obs ID → { text, id } from a linked COMM note (derived-from relationship)
      const resultCommentMap = new Map<string, { text: string; id: string }>()

      type RelatedEntry = { type?: string; target?: { reference?: string } }
      for (const obs of resultObs) {
        if (obs.code?.coding?.[0]?.code === COMMENT_NOTE_CODE) {
          const derivedFromRef = ((obs as unknown as { related?: RelatedEntry[] }).related ?? [])
            .find(r => r.type === 'derived-from')?.target?.reference
          if (derivedFromRef) {
            // Per-result comment — store against parent obs ID
            const parentId = extractId(derivedFromRef)
            if (parentId && obs.comment) resultCommentMap.set(parentId, { text: obs.comment, id: obs.id ?? '' })
          } else {
            // No parent link → panel-level filing comment
            filingComment = obs.comment || undefined
            const castObs = obs as unknown as { effectiveDateTime?: string }
            filingCommentDate = formatDate(castObs.effectiveDateTime ?? obs.issued)
            const perfs = (Array.isArray(obs.performer) ? obs.performer : obs.performer ? [obs.performer] : []) as Array<{ display?: string }>
            filingCommentPerformer = perfs[0]?.display ?? undefined
          }
          // Either way, COMM notes never go into labObs
        } else {
          labObs.push(obs)
        }
      }

      // Helper: spread extractObsResult and merge any linked COMM comment
      const obsResult = (obs: ObsLike) => {
        const r = extractObsResult(obs)
        const linked = obs.id ? resultCommentMap.get(obs.id) : undefined
        return {
          ...r,
          comment: r.comment || linked?.text || undefined,
          commentObservationId: linked?.id || undefined,
        }
      }

      // Build test groups.
      // Three modes: (1) has-member groups (new GP Connect style), (2) explicit TPP groups,
      // (3) implicit EMIS groups. Detection order: check for has-member first.
      const testGroups: GpConnectTestGroup[] = []

      // hasMemberPattern is true only when a has-member reference points to a non-COMM
      // analyte observation. EMIS also uses has-member to link result→comment-note pairs,
      // which must NOT be mistaken for the "new GP Connect group container" pattern.
      // Some vendor bundles (e.g. Orange Labs) omit related.type entirely on these links —
      // an untyped Observation-to-Observation relation here is a has-member link in practice.
      const isMemberRelation = (r: RelatedEntry) => r.type === 'has-member' || r.type === undefined
      const hasMemberPattern = labObs.some(obs =>
        ((obs as unknown as { related?: RelatedEntry[] }).related ?? [])
          .filter(isMemberRelation)
          .some(r => {
            const target = resolveReference(bundle, r.target?.reference) as ObsLike | undefined
            return target && target.code?.coding?.[0]?.code !== COMMENT_NOTE_CODE
          })
      )

      if (hasMemberPattern) {
        // New GP Connect style: each labObs that has has-member children is a Test Group container.
        // The actual results are only reachable via those has-member references.
        for (const obs of labObs) {
          const castRelated = obs as unknown as {
            related?: Array<{ type?: string; target?: { reference?: string } }>
            effectiveDateTime?: string
          }
          const memberRefs = (castRelated.related ?? [])
            .filter(isMemberRelation)
            .map(r => r.target?.reference)
            .filter((r): r is string => !!r)

          // A has-member link may point straight to a per-result COMM note (e.g. EMIS's
          // "(EMISTest) - Abnormal - Contact Patient" flag on a standalone CRP/iron result).
          // These never appear in DiagnosticReport.result[] themselves, so register them in
          // resultCommentMap here — the same map the top-level derived-from scan populates —
          // otherwise the annotation is silently dropped.
          for (const ref of memberRefs) {
            const target = resolveReference(bundle, ref) as ObsLike | undefined
            if (target?.code?.coding?.[0]?.code !== COMMENT_NOTE_CODE || !target.comment) continue
            const derivedFromRef = ((target as unknown as { related?: RelatedEntry[] }).related ?? [])
              .find(r => r.type === 'derived-from')?.target?.reference
            const parentId = derivedFromRef ? extractId(derivedFromRef) : obs.id
            if (parentId) resultCommentMap.set(parentId, { text: target.comment, id: target.id ?? '' })
          }

          // A has-member link to a COMMENT_NOTE_CODE observation is a per-result annotation
          // (e.g. EMIS's "(EMISTest) - Abnormal - Contact Patient" flag), not a child analyte.
          // An observation whose only has-member links are like this (e.g. a standalone CRP
          // result linked to its own comment note) is itself a result, not a group container —
          // resolve and filter before deciding, otherwise it renders as an empty, value-less group.
          const analyteMemberRefs = memberRefs.filter(ref => {
            const target = resolveReference(bundle, ref) as ObsLike | undefined
            return target && target.code?.coding?.[0]?.code !== COMMENT_NOTE_CODE
          })

          if (analyteMemberRefs.length > 0) {
            const obsCoding = obs.code?.coding
            // A group header's own comment can either be inline (obs.comment) or, as with
            // "Urea and electrolytes level"'s "(EMISTest) - Normal - No Action", live in a
            // has-member-linked COMM note whose derived-from points back at this same header —
            // already registered in resultCommentMap by the scan above.
            const linkedGroupComment = obs.id ? resultCommentMap.get(obs.id) : undefined
            const inlineGroupComment = cleanGroupComment(obs.comment)
            const group: GpConnectTestGroup = {
              id: obs.id ?? crypto.randomUUID(),
              name: resolveObsName(obs, 'Results'),
              snomedCode: extractSnomedCode(obsCoding),
              comment: inlineGroupComment ?? linkedGroupComment?.text,
              commentObservationId: inlineGroupComment ? undefined : linkedGroupComment?.id,
              date: formatDate(castRelated.effectiveDateTime ?? obs.issued),
              isTransferDegraded: isTransferDegradedObs(obs) || undefined,
              interpretation: normalizeInterpretation(obs.interpretation, obs.comment),
              specimen: obsSpecimen(obs),
              results: [],
            }
            for (const memberRef of analyteMemberRefs) {
              const memberObs = resolveReference(bundle, memberRef) as ObsLike | undefined
              if (!memberObs) continue
              const memberCoding = memberObs.code?.coding
              group.results.push({
                id: memberObs.id ?? crypto.randomUUID(),
                reportId,
                name: resolveObsName(memberObs, 'Result'),
                snomedCode: extractSnomedCode(memberCoding),
                isTransferDegraded: isTransferDegradedObs(memberObs) || undefined,
                ...obsResult(memberObs),
              })
            }
            testGroups.push(group)
          } else {
            // A standalone result referenced directly in DiagnosticReport.result[] (not
            // reached only via a parent's has-member list, like Serum urea level is via
            // "Urea and electrolytes") is its own result, not a member of a shared group —
            // each becomes its own single-result group, whose title is promoted to the
            // result's own name below (e.g. CRP, iron and TIBC each get their own heading).
            const obsCoding = obs.code?.coding
            const castObs = obs as unknown as { effectiveDateTime?: string }
            const singleResultGroup: GpConnectTestGroup = {
              id: obs.id ?? crypto.randomUUID(),
              name: '',
              snomedCode: extractSnomedCode(obsCoding),
              date: formatDate(castObs.effectiveDateTime ?? obs.issued),
              isTransferDegraded: isTransferDegradedObs(obs) || undefined,
              specimen: obsSpecimen(obs),
              results: [{
                id: obs.id ?? crypto.randomUUID(),
                reportId,
                name: resolveObsName(obs, 'Result'),
                snomedCode: extractSnomedCode(obsCoding),
                isTransferDegraded: isTransferDegradedObs(obs) || undefined,
                ...obsResult(obs),
              }],
            }
            testGroups.push(singleResultGroup)
          }
        }
      } else {
        // Existing logic: explicit TPP groups (code 364712009) or implicit EMIS groups.
        const hasExplicitGroups = labObs.some(obs => obs.code?.coding?.[0]?.code === GROUP_HEADER_CODE)

        let currentGroup: GpConnectTestGroup | null = null
        let prevHadValue = false

        for (const obs of labObs) {
          const code = obs.code?.coding?.[0]?.code ?? ''
          if (code === SKIP_CODE) continue

          const hasValue = obsHasValue(obs)
          const isGroupHeader = hasExplicitGroups
            ? code === GROUP_HEADER_CODE
            : !hasValue && (testGroups.length === 0 || prevHadValue)

          if (isGroupHeader) {
            const obsCoding = obs.code?.coding
            const castObs = obs as unknown as { effectiveDateTime?: string }
            currentGroup = {
              id: obs.id ?? crypto.randomUUID(),
              name: groupHeaderName(obs),
              snomedCode: extractSnomedCode(obsCoding),
              comment: cleanGroupComment(obs.comment),
              date: formatDate(castObs.effectiveDateTime ?? obs.issued),
              isTransferDegraded: isTransferDegradedObs(obs) || undefined,
              interpretation: normalizeInterpretation(obs.interpretation, obs.comment),
              specimen: obsSpecimen(obs),
              results: [],
            }
            testGroups.push(currentGroup)
            prevHadValue = false
          } else {
            if (!currentGroup) {
              currentGroup = { id: `${reportId}-direct`, name: '', specimen: obsSpecimen(obs), results: [] }
              testGroups.push(currentGroup)
            }
            const obsCoding = obs.code?.coding
            const isSubHeader = hasExplicitGroups && !hasValue && !obs.comment
            const result: GpConnectInvestigationResult = {
              id: obs.id ?? crypto.randomUUID(),
              reportId,
              name: resolveObsName(obs, 'Result'),
              snomedCode: extractSnomedCode(obsCoding),
              isSubHeader,
              isTransferDegraded: isTransferDegradedObs(obs) || undefined,
              ...obsResult(obs),
            }
            currentGroup.results.push(result)
            prevHadValue = hasValue
          }
        }
      }

      // Group title fallback: an unnamed group holding exactly one result (e.g. a standalone
      // "Fasting glucose" test with no panel container) shows that result's name as its title,
      // instead of a blank header.
      for (const g of testGroups) {
        if (!g.name && g.results.length === 1) {
          g.name = g.results[0].name
        }
      }

      // Report-level specimen: shown once when every group shares a single specimen, matching
      // the previous single-specimen display. When groups reference different specimens (e.g.
      // serum for renal/lipids vs EDTA for FBC) each TestGroupSection shows its own instead, so
      // results are never shown against the wrong sample.
      const distinctSpecimens = new Map<string, GpConnectSpecimen>()
      for (const g of testGroups) if (g.specimen) distinctSpecimens.set(g.specimen.id, g.specimen)
      const specimen = distinctSpecimens.size === 1 ? [...distinctSpecimens.values()][0] : undefined
      if (specimen) {
        for (const g of testGroups) g.specimen = undefined
      }

      // Flat results list (for summary shortcuts + backward compat)
      const results = testGroups.flatMap(g => g.results).filter(r => !r.isSubHeader)

      // Report name derivation — priority order:
      // 1. Filing comment title  2. DR code when specific (not the generic category code)
      // 3. First group name  4. Single result name (last resort)
      let reportName: string | undefined
      if (filingComment) {
        const m = filingComment.match(/^Title:\s+([^\n\r]+)/m)
        if (m) reportName = m[1].trim()
      }
      if (!reportName) {
        const drName = extractOriginalTermText(report.code)
        // 721981007 "Diagnostic studies report" is the generic category code used for ALL
        // TPP/EMIS lab DiagnosticReports — skip it and derive the name from the test group.
        if (drName && drName.toLowerCase() !== 'diagnostic studies report') {
          reportName = drName
        }
      }
      if (!reportName && testGroups.length > 0 && testGroups[0].name) {
        reportName = testGroups[0].name
      }
      if (!reportName && results.length > 0 && testGroups.length === 1 && !testGroups[0].name) {
        reportName = results[0].name
      }
      reportName = reportName ?? 'Investigation'

      const category = extractOriginalTermText(report.category as fhir3.CodeableConcept | undefined)

      // Only surface result shortcuts in the table for single-result tests (no named panel groups)
      const isPanel = testGroups.some(g => g.name)
      const first = isPanel ? undefined : results[0]
      const panelInterpretation = testGroups.find(g => g.interpretation)?.interpretation
      return {
        id: reportId,
        date: formatDate(report.issued ?? castReport.effectiveDateTime),
        name: reportName,
        status: report.status,
        category,
        performer,
        performerId,
        performers,
        encounterId,
        specimen,
        procedureRequest,
        filingComment,
        filingCommentDate,
        filingCommentPerformer,
        testGroups,
        results,
        result: first?.value,
        unit: first?.unit,
        referenceRange: first?.referenceRange,
        interpretation: first?.interpretation ?? panelInterpretation,
        notForPfs: hasNopatSecurity(report),
      }
    })
}
