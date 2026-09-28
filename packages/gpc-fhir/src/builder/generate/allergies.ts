import type { DraftRecord, DraftAllergy } from '../types'
import type { TempIdMap } from '../idMap'
import { excludeConfidential, nopatMeta } from './security'

const END_EXT = 'https://fhir.nhs.uk/STU3/StructureDefinition/Extension-CareConnect-GPC-AllergyIntoleranceEnd-1'

function makeAllergyResource(
  draft: DraftAllergy,
  map: TempIdMap,
  patientRef: string,
): fhir3.AllergyIntolerance {
  const { id } = map.entry(draft._tempId)

  const endExt: fhir3.Extension | undefined =
    draft.status === 'resolved' && (draft.endDate || draft.endReason)
      ? {
          url: END_EXT,
          extension: [
            ...(draft.endDate ? [{ url: 'endDate', valueDateTime: draft.endDate }] : []),
            ...(draft.endReason ? [{ url: 'reasonEnded', valueString: draft.endReason }] : []),
          ],
        }
      : undefined

  const resource: fhir3.AllergyIntolerance = {
    resourceType: 'AllergyIntolerance',
    id,
    ...nopatMeta(draft.notForPfs),
    clinicalStatus: draft.status ?? 'active',
    verificationStatus: 'confirmed',
    ...(draft.category ? { category: [draft.category] } : {}),
    ...(draft.criticality ? { criticality: draft.criticality } : {}),
    code: {
      ...(draft.snomedCode || draft.causativeAgent
        ? {
            coding: [
              {
                system: 'http://snomed.info/sct',
                ...(draft.snomedCode ? { code: draft.snomedCode } : {}),
                ...(draft.causativeAgent ? { display: draft.causativeAgent } : {}),
              },
            ],
          }
        : {}),
      ...(draft.causativeAgent ? { text: draft.causativeAgent } : {}),
    },
    patient: { reference: patientRef },
    ...(draft.onsetDate ? { onsetDateTime: draft.onsetDate } : {}),
    ...(draft.lastOccurrence ? { lastOccurrence: draft.lastOccurrence } : {}),
    ...(draft.recorderTempId
      ? { recorder: { reference: map.ref(draft.recorderTempId, 'Practitioner') } }
      : {}),
    ...(draft.reaction
      ? {
          reaction: [
            {
              manifestation: [
                {
                  coding: [{
                    system: 'http://snomed.info/sct',
                    ...(draft.reactionCode ? { code: draft.reactionCode } : {}),
                    ...(draft.reaction ? { display: draft.reaction } : {}),
                  }],
                  ...(draft.reaction ? { text: draft.reaction } : {}),
                },
              ],
              ...(draft.reactionDescription ? { description: draft.reactionDescription } : {}),
              ...(draft.reactionOnset ? { onset: draft.reactionOnset } : {}),
              ...(draft.reactionSeverity ? { severity: draft.reactionSeverity } : {}),
            },
          ],
        }
      : {}),
    ...(draft.associatedText ? { note: [{ text: draft.associatedText }] } : {}),
    ...(endExt ? { extension: [endExt] } : {}),
  }

  // assertedDate is not in the fhir3 type definition but is a valid GP Connect STU3 field
  if (draft.assertedDate) {
    (resource as unknown as Record<string, unknown>)['assertedDate'] = draft.assertedDate
  }

  return resource
}

export function generateAllergies(
  draft: DraftRecord,
  map: TempIdMap,
  patientRef: string,
): { activeEntries: fhir3.BundleEntry[]; endedListEntry: fhir3.BundleEntry | null } {
  const activeEntries: fhir3.BundleEntry[] = []
  const resolvedResources: fhir3.AllergyIntolerance[] = []

  for (const allergy of excludeConfidential(draft.allergies)) {
    const resource = makeAllergyResource(allergy, map, patientRef)
    if (allergy.status === 'resolved') {
      resolvedResources.push(resource)
    } else {
      const { fullUrl } = map.entry(allergy._tempId)
      activeEntries.push({ fullUrl, resource })
    }
  }

  if (resolvedResources.length === 0) {
    return { activeEntries, endedListEntry: null }
  }

  const listId = crypto.randomUUID()
  const endedList: fhir3.List = {
    resourceType: 'List',
    id: listId,
    status: 'current',
    mode: 'snapshot',
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '1103671000000101',
          display: 'Ended allergies',
        },
      ],
    },
    subject: { reference: patientRef },
    contained: resolvedResources,
    entry: resolvedResources.map(r => ({ item: { reference: '#' + r.id } })),
  }

  const endedListEntry: fhir3.BundleEntry = {
    fullUrl: `urn:uuid:${listId}`,
    resource: endedList,
  }

  return { activeEntries, endedListEntry }
}
