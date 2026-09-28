import type { DraftRecord, DraftInvestigationResult, DraftTestGroup, DraftSpecimen, DraftTestRequest } from '../types'
import type { TempIdMap } from '../idMap'
import { excludeConfidential, nopatMeta } from './security'

// ---------------------------------------------------------------------------
// GP Connect Investigations model — Test Report (DiagnosticReport) contains
// one or more Test Groups (Observation, linked via `related` has-member to
// their child Test Results), plus zero or more linked Specimens and Test
// Requests (ProcedureRequest), a report-level "Lab Comment" filing comment,
// and an optional "Lab Comment" and/or "GP Filing Comment" per test group —
// all filing comments are Comment Note Observations (SNOMED 37331000000100),
// has-member linked at whichever level they were added. Result-level
// comments still ride inline (the same non-standard `.comment` convention
// already used elsewhere in this generator) since GP Connect has no
// guidance calling for a separate filing-comment resource that granular.
// https://simplifier.net/guide/gp-connect-access-record-structured/Home/Design/Investigations-guidance
// ---------------------------------------------------------------------------

const SNOMED = 'http://snomed.info/sct'
const COMMENT_NOTE_CODE = '37331000000100'

function makeResultObservation(
  result: DraftInvestigationResult,
  map: TempIdMap,
  patientRef: string,
  notForPfs: boolean | undefined,
): { entry: fhir3.BundleEntry; ref: string } {
  const { id, fullUrl } = map.entry(result._tempId)

  const hasUnit = Boolean(result.unit)
  const hasValue = result.value !== undefined && result.value !== ''

  const valueFields: Partial<fhir3.Observation> = hasValue
    ? hasUnit
      ? { valueQuantity: { value: parseFloat(result.value!), unit: result.unit } }
      : { valueString: result.value }
    : {}

  const referenceRange: fhir3.ObservationReferenceRange[] | undefined =
    result.referenceRangeLow || result.referenceRangeHigh
      ? [
          {
            ...(result.referenceRangeLow
              ? { low: { value: parseFloat(result.referenceRangeLow) } }
              : {}),
            ...(result.referenceRangeHigh
              ? { high: { value: parseFloat(result.referenceRangeHigh) } }
              : {}),
          },
        ]
      : undefined

  const resource: fhir3.Observation & { comment?: string } = {
    resourceType: 'Observation',
    id,
    ...nopatMeta(notForPfs),
    status: 'final',
    code: {
      coding: [
        {
          system: SNOMED,
          ...(result.snomedCode ? { code: result.snomedCode } : {}),
          ...(result.name ? { display: result.name } : {}),
        },
      ],
      ...(result.name ? { text: result.name } : {}),
    },
    subject: { reference: patientRef },
    ...valueFields,
    ...(referenceRange ? { referenceRange } : {}),
    ...(result.interpretation
      ? { interpretation: { coding: [{ display: result.interpretation }] } }
      : {}),
    ...(result.comment ? { comment: result.comment } : {}),
  }

  return { entry: { fullUrl, resource }, ref: `Observation/${id}` }
}

function makeGroupObservation(
  group: DraftTestGroup,
  memberRefs: string[],
  map: TempIdMap,
  patientRef: string,
  issuedDate: string,
  notForPfs: boolean | undefined,
): { entry: fhir3.BundleEntry; ref: string } {
  const { id, fullUrl } = map.entry(group._tempId)

  const resource: fhir3.Observation = {
    resourceType: 'Observation',
    id,
    ...nopatMeta(notForPfs),
    status: 'final',
    code: {
      coding: [
        {
          system: SNOMED,
          ...(group.snomedCode ? { code: group.snomedCode } : {}),
          ...(group.name ? { display: group.name } : {}),
        },
      ],
      ...(group.name ? { text: group.name } : {}),
    },
    subject: { reference: patientRef },
    effectiveDateTime: issuedDate,
    ...(memberRefs.length > 0
      ? { related: memberRefs.map(ref => ({ type: 'has-member', target: { reference: ref } })) }
      : {}),
  }

  return { entry: { fullUrl, resource }, ref: `Observation/${id}` }
}

// A filing comment — a Comment Note Observation with no derived-from link of
// its own, has-member linked in wherever it was added (report-level: listed
// directly in DiagnosticReport.result[]; group-level: has-member linked into
// that group's own Observation, alongside its results).
function makeFilingCommentObservation(
  tempIdKey: string,
  comment: string,
  map: TempIdMap,
  patientRef: string,
  issuedDate: string,
  notForPfs: boolean | undefined,
): { entry: fhir3.BundleEntry; ref: string } {
  const { id, fullUrl } = map.entry(tempIdKey)

  const resource: fhir3.Observation & { comment?: string } = {
    resourceType: 'Observation',
    id,
    ...nopatMeta(notForPfs),
    status: 'final',
    code: {
      coding: [{ system: SNOMED, code: COMMENT_NOTE_CODE, display: 'Comment note' }],
    },
    subject: { reference: patientRef },
    effectiveDateTime: issuedDate,
    comment,
  }

  return { entry: { fullUrl, resource }, ref: `Observation/${id}` }
}

function makeSpecimen(
  specimen: DraftSpecimen,
  map: TempIdMap,
  patientRef: string,
): { entry: fhir3.BundleEntry; ref: string } | undefined {
  const hasContent = specimen.type || specimen.snomedCode || specimen.collectedDate
    || specimen.receivedDate || specimen.status || specimen.note
  if (!hasContent) return undefined

  const { id, fullUrl } = map.entry(specimen._tempId)

  const resource: fhir3.Specimen = {
    resourceType: 'Specimen',
    id,
    subject: { reference: patientRef },
    ...(specimen.type || specimen.snomedCode
      ? {
          type: {
            coding: [
              {
                system: SNOMED,
                ...(specimen.snomedCode ? { code: specimen.snomedCode } : {}),
                ...(specimen.type ? { display: specimen.type } : {}),
              },
            ],
            ...(specimen.type ? { text: specimen.type } : {}),
          },
        }
      : {}),
    ...(specimen.status ? { status: specimen.status } : {}),
    ...(specimen.collectedDate ? { collection: { collectedDateTime: specimen.collectedDate } } : {}),
    ...(specimen.receivedDate ? { receivedTime: specimen.receivedDate } : {}),
    ...(specimen.note ? { note: [{ text: specimen.note }] } : {}),
  }

  return { entry: { fullUrl, resource }, ref: `Specimen/${id}` }
}

function makeTestRequest(
  request: DraftTestRequest,
  map: TempIdMap,
  patientRef: string,
): { entry: fhir3.BundleEntry; ref: string } | undefined {
  if (!request.name && !request.snomedCode) return undefined

  const { id, fullUrl } = map.entry(request._tempId)

  const resource: fhir3.ProcedureRequest = {
    resourceType: 'ProcedureRequest',
    id,
    status: (request.status as fhir3.ProcedureRequest['status']) ?? 'active',
    intent: (request.intent as fhir3.ProcedureRequest['intent']) ?? 'order',
    subject: { reference: patientRef },
    code: {
      coding: [
        {
          system: SNOMED,
          ...(request.snomedCode ? { code: request.snomedCode } : {}),
          ...(request.name ? { display: request.name } : {}),
        },
      ],
      ...(request.name ? { text: request.name } : {}),
    },
    ...(request.requesterTempId
      ? { requester: { agent: { reference: map.ref(request.requesterTempId, 'Practitioner') } } }
      : {}),
  }

  return { entry: { fullUrl, resource }, ref: `ProcedureRequest/${id}` }
}

export function generateInvestigations(
  draft: DraftRecord,
  map: TempIdMap,
  patientRef: string,
): fhir3.BundleEntry[] {
  const entries: fhir3.BundleEntry[] = []

  for (const inv of excludeConfidential(draft.investigations)) {
    const { id, fullUrl } = map.entry(inv._tempId)
    const issuedDate = inv.date ? new Date(inv.date).toISOString() : new Date().toISOString()

    // DiagnosticReport.result[] holds a reference per Test Group (not the
    // individual results — those are only reachable via each group's
    // has-member links), plus the report-level filing comment if present.
    const resultRefs: string[] = []

    for (const group of inv.testGroups) {
      const memberRefs: string[] = []

      const groupResults = group.results.map(r => makeResultObservation(r, map, patientRef, inv.notForPfs))
      for (const { entry } of groupResults) entries.push(entry)
      memberRefs.push(...groupResults.map(r => r.ref))

      // "Lab Comment" and "GP Filing Comment" — each its own Comment Note
      // Observation, has-member linked into this group alongside its
      // results (not inline on the group's own Observation, so they stay
      // genuine filing-comment resources per GP Connect guidance). The two
      // are independent: the lab's comment on the results vs. the GP's
      // comment on filing them.
      if (group.labComment) {
        const { entry, ref } = makeFilingCommentObservation(
          `${group._tempId}::labcomment`, group.labComment, map, patientRef, issuedDate, inv.notForPfs,
        )
        entries.push(entry)
        memberRefs.push(ref)
      }
      if (group.comment) {
        const { entry, ref } = makeFilingCommentObservation(
          `${group._tempId}::comment`, group.comment, map, patientRef, issuedDate, inv.notForPfs,
        )
        entries.push(entry)
        memberRefs.push(ref)
      }

      const { entry: groupEntry, ref: groupRef } = makeGroupObservation(
        group, memberRefs, map, patientRef, issuedDate, inv.notForPfs,
      )
      entries.push(groupEntry)
      resultRefs.push(groupRef)
    }

    // Report-level "Lab Comment"
    if (inv.comment) {
      const { entry, ref } = makeFilingCommentObservation(
        `${inv._tempId}::comment`, inv.comment, map, patientRef, issuedDate, inv.notForPfs,
      )
      entries.push(entry)
      resultRefs.push(ref)
    }

    const specimens = inv.specimens
      .map(s => makeSpecimen(s, map, patientRef))
      .filter((s): s is { entry: fhir3.BundleEntry; ref: string } => s !== undefined)
    for (const { entry } of specimens) entries.push(entry)

    const testRequests = inv.testRequests
      .map(r => makeTestRequest(r, map, patientRef))
      .filter((r): r is { entry: fhir3.BundleEntry; ref: string } => r !== undefined)
    for (const { entry } of testRequests) entries.push(entry)

    const report: fhir3.DiagnosticReport = {
      resourceType: 'DiagnosticReport',
      id,
      ...nopatMeta(inv.notForPfs),
      status: (inv.status as fhir3.DiagnosticReport['status']) ?? 'final',
      code: {
        coding: [
          {
            system: SNOMED,
            ...(inv.snomedCode ? { code: inv.snomedCode } : {}),
            ...(inv.name ? { display: inv.name } : {}),
          },
        ],
        ...(inv.name ? { text: inv.name } : {}),
      },
      subject: { reference: patientRef },
      issued: issuedDate,
      ...(inv.performerTempId
        ? { performer: [{ actor: { reference: map.ref(inv.performerTempId, 'Practitioner') } }] }
        : {}),
      ...(resultRefs.length > 0 ? { result: resultRefs.map(ref => ({ reference: ref })) } : {}),
      ...(specimens.length > 0 ? { specimen: specimens.map(s => ({ reference: s.ref })) } : {}),
      ...(testRequests.length > 0 ? { basedOn: testRequests.map(r => ({ reference: r.ref })) } : {}),
    }

    entries.push({ fullUrl, resource: report })
  }

  return entries
}
