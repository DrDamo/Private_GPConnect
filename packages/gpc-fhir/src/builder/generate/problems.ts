import type { DraftRecord, DraftProblem } from '../types'
import type { TempIdMap } from '../idMap'
import { excludeConfidential, nopatMeta } from './security'

const SIGNIFICANCE_EXT = 'https://fhir.hl7.org.uk/STU3/StructureDefinition/Extension-CareConnect-ProblemSignificance-1'
const SIGNIFICANCE_SYSTEM = 'https://fhir.nhs.uk/STU3/CodeSystem/CareConnect-ProblemSignificance-1'
const RELATED_CONTENT_EXT = 'https://fhir.nhs.uk/STU3/StructureDefinition/Extension-CareConnect-GPC-RelatedClinicalContent-1'
// EMIS/TPP problem-hierarchy extension (Group/Combine/Evolve) — see docs/emis-tpp-medicus-variations.md
// and src/fhir/problems.ts (the read side of this same extension).
const RELATED_PROBLEM_HEADER_EXT = 'https://fhir.hl7.org.uk/STU3/StructureDefinition/Extension-CareConnect-RelatedProblemHeader-1'

// Groups draft.problems by relatedProblemParentTempId, dropping any link where the parent is
// missing (dangling tempId, e.g. after the parent was deleted) or itself confidential (excluded
// from the generated bundle, so a Condition/<id> reference to it would dangle) — such a child
// is generated as a plain standalone problem instead of silently producing a broken reference.
function buildChildrenByParent(problems: DraftProblem[]): Map<string, DraftProblem[]> {
  const byId = new Map(problems.map(p => [p._tempId, p]))
  const childrenByParent = new Map<string, DraftProblem[]>()
  for (const p of problems) {
    if (p.confidential || !p.relatedProblemParentTempId) continue
    const parent = byId.get(p.relatedProblemParentTempId)
    if (!parent || parent.confidential) continue
    if (!childrenByParent.has(parent._tempId)) childrenByParent.set(parent._tempId, [])
    childrenByParent.get(parent._tempId)!.push(p)
  }
  return childrenByParent
}

function relatedProblemHeaderExt(type: 'parent' | 'child' | 'sibling', targetRef: string): fhir3.Extension {
  return {
    url: RELATED_PROBLEM_HEADER_EXT,
    extension: [
      { url: 'type', valueCode: type },
      { url: 'target', valueReference: { reference: targetRef } },
    ],
  } as unknown as fhir3.Extension
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// DD-Mon-YYYY, matching the date format seen in real EMIS "(Evolved into X …)" notes.
function formatEmisDate(iso: string): string | undefined {
  const d = new Date(`${iso}T00:00:00`)
  if (isNaN(d.getTime())) return undefined
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`
}

// Descriptive note text on the PARENT side, matching wording observed in a real EMIS bundle
// (see docs/emis-tpp-medicus-variations.md). EMIS leaves no such note for a "combine" target,
// so that case returns undefined and contributes nothing.
function parentNoteFor(eventType: DraftProblem['relatedProblemEventType'], childNames: string[], parentName: string): string | undefined {
  const namesJoined = joinNames(childNames)
  if (eventType === 'group') return `${namesJoined} ${childNames.length > 1 ? 'all GROUPED' : 'GROUPED'} under ${parentName}`
  if (eventType === 'evolve') return `${namesJoined} ${childNames.length > 1 ? 'were' : 'was'} evolved into ${parentName}`
  return undefined
}

// Descriptive note text on the CHILD side, matching wording observed in a real EMIS bundle.
function childNoteFor(eventType: DraftProblem['relatedProblemEventType'] | undefined, parentName: string, parentStartDate?: string): string {
  if (eventType === 'group') return `(Grouped with ${parentName})`
  if (eventType === 'evolve') {
    const date = parentStartDate ? formatEmisDate(parentStartDate) : undefined
    return `(Evolved into ${parentName}${date ? ' ' + date : ''})`
  }
  return `(Combined with ${parentName})`
}

// Fixed SNOMED CT codes for Condition.severity — a subjective clinician
// assessment, not a coded search field, so the UI offers just these three.
const SEVERITY_CODES: Record<'severe' | 'moderate' | 'mild', { code: string; display: string }> = {
  severe: { code: '24484000', display: 'Severe' },
  moderate: { code: '6736007', display: 'Moderate' },
  mild: { code: '255604002', display: 'Mild' },
}

export function generateProblems(
  draft: DraftRecord,
  map: TempIdMap,
  patientRef: string,
  relatedContent: Map<string, string[]>,
): fhir3.BundleEntry[] {
  const problemById = new Map(draft.problems.map(p => [p._tempId, p]))
  const childrenByParent = buildChildrenByParent(draft.problems)

  return excludeConfidential(draft.problems).map(p => {
    const { id, fullUrl } = map.entry(p._tempId)

    const significanceCode = p.significance ?? 'minor'
    const significanceDisplay = p.significance === 'major' ? 'Significant' : 'Minor'

    const extensions: fhir3.Extension[] = [
      {
        url: SIGNIFICANCE_EXT,
        valueCodeableConcept: {
          coding: [
            {
              system: SIGNIFICANCE_SYSTEM,
              code: significanceCode,
              display: significanceDisplay,
            },
          ],
        },
      },
    ]

    const refs = relatedContent.get(p._tempId) ?? []
    for (const ref of refs) {
      extensions.push({ url: RELATED_CONTENT_EXT, valueReference: { reference: ref } })
    }

    // EMIS/TPP Group/Combine/Evolve problem hierarchy (Extension-CareConnect-
    // RelatedProblemHeader-1) — one "child" link per child, a "parent" link plus one
    // "sibling" link per other child when this problem IS a child, and the matching
    // EMIS-style free-text notes on both ends. See buildChildrenByParent above for how
    // a dangling/confidential parent is treated as no relation at all.
    const children = childrenByParent.get(p._tempId) ?? []
    const parent = p.relatedProblemParentTempId ? problemById.get(p.relatedProblemParentTempId) : undefined
    const isLinkedToParent = !!parent && !parent.confidential
    const autoNotes: string[] = []

    for (const child of children) {
      extensions.push(relatedProblemHeaderExt('child', map.ref(child._tempId, 'Condition')))
    }
    if (children.length > 0) {
      const byEventType = new Map<string, DraftProblem[]>()
      for (const child of children) {
        const eventType = child.relatedProblemEventType ?? 'group'
        if (!byEventType.has(eventType)) byEventType.set(eventType, [])
        byEventType.get(eventType)!.push(child)
      }
      for (const [eventType, group] of byEventType) {
        const note = parentNoteFor(
          eventType as DraftProblem['relatedProblemEventType'],
          group.map(c => c.problem || 'Unnamed problem'),
          p.problem || 'this problem',
        )
        if (note) autoNotes.push(note)
      }
    }

    if (isLinkedToParent && parent) {
      extensions.push(relatedProblemHeaderExt('parent', map.ref(parent._tempId, 'Condition')))
      for (const sibling of childrenByParent.get(parent._tempId) ?? []) {
        if (sibling._tempId === p._tempId) continue
        extensions.push(relatedProblemHeaderExt('sibling', map.ref(sibling._tempId, 'Condition')))
      }
      autoNotes.push(childNoteFor(p.relatedProblemEventType, parent.problem || 'this problem', parent.startDate))
    }

    const resource: fhir3.Condition = {
      resourceType: 'Condition',
      id,
      ...nopatMeta(p.notForPfs),
      extension: extensions,
      clinicalStatus: p.clinicalStatus ?? 'active',
      verificationStatus: 'confirmed',
      code: {
        ...(p.snomedCode || p.problem
          ? {
              coding: [
                {
                  system: 'http://snomed.info/sct',
                  ...(p.snomedCode ? { code: p.snomedCode } : {}),
                  ...(p.problem ? { display: p.problem } : {}),
                },
              ],
            }
          : {}),
        ...(p.problem ? { text: p.problem } : {}),
      },
      ...(p.severity
        ? {
            severity: {
              coding: [
                {
                  system: 'http://snomed.info/sct',
                  code: SEVERITY_CODES[p.severity].code,
                  display: SEVERITY_CODES[p.severity].display,
                },
              ],
            },
          }
        : {}),
      subject: { reference: patientRef },
      ...(p.startDate ? { onsetDateTime: p.startDate } : {}),
      ...(p.endDate ? { abatementDateTime: p.endDate } : {}),
      ...(p.asserterTempId
        ? { asserter: { reference: map.ref(p.asserterTempId, 'Practitioner') } }
        : {}),
      ...(() => {
        const noteTexts = [...(p.associatedText ? [p.associatedText] : []), ...autoNotes]
        return noteTexts.length > 0 ? { note: noteTexts.map(text => ({ text })) } : {}
      })(),
    }

    // assertedDate is a GP Connect STU3 field not in the fhir3 type definition
    if (p.assertedDate) {
      (resource as unknown as Record<string, unknown>)['assertedDate'] = p.assertedDate
    }

    return { fullUrl, resource }
  })
}
