import type { DraftRecord } from '../types'
import type { TempIdMap } from '../idMap'

function makeTelecom(phone?: string, email?: string): fhir3.ContactPoint[] | undefined {
  const arr: fhir3.ContactPoint[] = []
  if (phone) arr.push({ system: 'phone', value: phone, use: 'home' })
  if (email) arr.push({ system: 'email', value: email })
  return arr.length ? arr : undefined
}

const LANGUAGE_ISO_CODES: Record<string, string> = {
  English: 'en', Polish: 'pl', Urdu: 'ur', Punjabi: 'pa', Bengali: 'bn',
  Gujarati: 'gu', Arabic: 'ar', Portuguese: 'pt', Romanian: 'ro',
  Spanish: 'es', French: 'fr', Somali: 'so', Turkish: 'tr',
  'Chinese (Mandarin)': 'zh', 'Chinese (Cantonese)': 'yue',
}

const PROFICIENCY_CODES: Record<string, string> = { Excellent: 'E', Good: 'G', Fair: 'F', Poor: 'P' }

const MODE_CODES: Record<string, string> = {
  'Received spoken': 'RSP', 'Received written': 'RWR',
  'Expressed spoken': 'ESP', 'Expressed written': 'EWR',
}

function makeCommunicationExt(p: DraftRecord['patient']): fhir3.Extension | undefined {
  if (!p.preferredLanguage) return undefined
  return {
    url: 'https://fhir.nhs.uk/STU3/StructureDefinition/Extension-CareConnect-GPC-NHSCommunication-1',
    extension: [
      {
        url: 'language',
        valueCodeableConcept: {
          coding: [
            {
              system: 'https://fhir.nhs.uk/STU3/CodeSystem/CareConnect-HumanLanguage-1',
              code: LANGUAGE_ISO_CODES[p.preferredLanguage] ?? undefined,
              display: p.preferredLanguage,
            },
          ],
        },
      },
      { url: 'preferred', valueBoolean: true },
      ...(p.modeOfCommunication
        ? [{
            url: 'modeOfCommunication',
            valueCodeableConcept: {
              coding: [
                {
                  system: 'https://fhir.nhs.uk/STU3/CodeSystem/CareConnect-LanguageAbilityMode-1',
                  code: MODE_CODES[p.modeOfCommunication],
                  display: p.modeOfCommunication,
                },
              ],
            },
          }]
        : []),
      ...(p.communicationProficiency
        ? [{
            url: 'communicationProficiency',
            valueCodeableConcept: {
              coding: [
                {
                  system: 'https://fhir.nhs.uk/STU3/CodeSystem/CareConnect-LanguageAbilityProficiency-1',
                  code: PROFICIENCY_CODES[p.communicationProficiency],
                  display: p.communicationProficiency,
                },
              ],
            },
          }]
        : []),
      { url: 'interpreterRequired', valueBoolean: p.interpreterRequired ?? false },
    ],
  }
}

function makePatient(draft: DraftRecord, map: TempIdMap): fhir3.BundleEntry {
  const { id, fullUrl } = map.entry(draft.patient._tempId)
  const p = draft.patient

  const verificationCode = p.nhsNumberVerified ? '01' : '04'
  const verificationDisplay = p.nhsNumberVerified ? 'Number present and verified' : 'Trace required'

  const nhsIdentifier: fhir3.Identifier | undefined = p.nhsNumber
    ? {
        system: 'https://fhir.nhs.uk/Id/nhs-number',
        value: p.nhsNumber,
        extension: [
          {
            url: 'https://fhir.hl7.org.uk/STU3/StructureDefinition/Extension-CareConnect-NHSNumberVerificationStatus-1',
            valueCodeableConcept: {
              coding: [
                {
                  system: 'https://fhir.hl7.org.uk/STU3/CodeSystem/CareConnect-NHSNumberVerificationStatus-1',
                  code: verificationCode,
                  display: verificationDisplay,
                },
              ],
            },
          },
        ],
      }
    : undefined

  const name: fhir3.HumanName = {
    use: 'official',
    ...(p.prefix ? { prefix: [p.prefix] } : {}),
    ...(p.givenName ? { given: [p.givenName] } : {}),
    ...(p.familyName ? { family: p.familyName } : {}),
  }

  const registrationExt: fhir3.Extension = {
    url: 'https://fhir.nhs.uk/STU3/StructureDefinition/Extension-CareConnect-GPC-RegistrationDetails-1',
    extension: [
      ...(p.registrationStart
        ? [{ url: 'registrationPeriod', valuePeriod: { start: p.registrationStart } }]
        : []),
      {
        url: 'registrationType',
        valueCodeableConcept: {
          coding: [
            {
              system: 'https://fhir.nhs.uk/STU3/CodeSystem/CareConnect-RegistrationType-1',
              code: 'R',
              display: 'Regular',
            },
          ],
        },
      },
    ],
  }

  const commExt = makeCommunicationExt(p)
  const contacts = makePatientContacts(p.contacts)

  const resource: fhir3.Patient = {
    resourceType: 'Patient',
    id,
    active: p.isActive ?? true,
    ...(nhsIdentifier ? { identifier: [nhsIdentifier] } : {}),
    name: [name],
    ...(p.gender ? { gender: p.gender } : {}),
    ...(p.dateOfBirth ? { birthDate: p.dateOfBirth } : {}),
    ...(p.address ? { address: [{ text: p.address }] } : {}),
    ...(makeTelecom(p.phone, p.email) ? { telecom: makeTelecom(p.phone, p.email) } : {}),
    ...(p.registeredGpTempId
      ? { generalPractitioner: [{ reference: map.ref(p.registeredGpTempId, 'Practitioner') }] }
      : {}),
    managingOrganization: { reference: map.ref(draft.organisation._tempId, 'Organization') },
    extension: [registrationExt, ...(commExt ? [commExt] : [])],
    ...(contacts ? { contact: contacts } : {}),
  }

  return { fullUrl, resource }
}

function makePatientContacts(contacts: DraftRecord['patient']['contacts']): fhir3.PatientContact[] | undefined {
  if (!contacts?.length) return undefined
  const built = contacts
    .map(c => {
      const name: fhir3.HumanName = {
        use: 'official',
        ...(c.prefix ? { prefix: [c.prefix] } : {}),
        ...(c.givenName ? { given: [c.givenName] } : {}),
        ...(c.familyName ? { family: c.familyName } : {}),
      }
      const hasName = c.prefix || c.givenName || c.familyName
      const contact: fhir3.PatientContact = {
        ...(c.relationship ? { relationship: [{ text: c.relationship }] } : {}),
        ...(hasName ? { name } : {}),
        ...(c.gender ? { gender: c.gender as fhir3.PatientContact['gender'] } : {}),
        ...(c.phone ? { telecom: [{ system: 'phone', value: c.phone, use: 'mobile' }] } : {}),
      }
      return contact
    })
    .filter(c => c.name || c.telecom)
  return built.length ? built : undefined
}

function makeOrg(o: DraftRecord['organisation'], map: TempIdMap): fhir3.BundleEntry {
  const { id, fullUrl } = map.entry(o._tempId)

  const resource: fhir3.Organization = {
    resourceType: 'Organization',
    id,
    ...(o.name ? { name: o.name } : {}),
    ...(o.odsCode
      ? {
          identifier: [
            { system: 'https://fhir.nhs.uk/Id/ods-organization-code', value: o.odsCode },
          ],
        }
      : {}),
    ...(o.phone ? { telecom: [{ system: 'phone', value: o.phone }] } : {}),
    ...(o.address ? { address: [{ text: o.address }] } : {}),
  }

  return { fullUrl, resource }
}

function makePractitioner(p: DraftRecord['practitioners'][number], map: TempIdMap): fhir3.BundleEntry {
  const { id, fullUrl } = map.entry(p._tempId)

  const name: fhir3.HumanName = {
    use: 'official',
    ...(p.prefix ? { prefix: [p.prefix] } : {}),
    ...(p.givenName ? { given: [p.givenName] } : {}),
    ...(p.familyName ? { family: p.familyName } : {}),
  }

  const resource: fhir3.Practitioner = {
    resourceType: 'Practitioner',
    id,
    meta: {
      profile: ['https://fhir.hl7.org.uk/STU3/StructureDefinition/CareConnect-Practitioner-1'],
    },
    name: [name],
    ...(p.sdsUserId
      ? { identifier: [{ system: 'https://fhir.nhs.uk/Id/sds-user-id', value: p.sdsUserId }] }
      : {}),
    ...(p.gender ? { gender: p.gender } : {}),
  }

  return { fullUrl, resource }
}

function makePractitionerRole(
  p: DraftRecord['practitioners'][number],
  orgRef: string,
  map: TempIdMap,
): fhir3.BundleEntry | undefined {
  if (!p.role) return undefined
  const { id, fullUrl } = map.entry(`practitionerrole-${p._tempId}`)

  const resource: fhir3.PractitionerRole = {
    resourceType: 'PractitionerRole',
    id,
    practitioner: { reference: map.ref(p._tempId, 'Practitioner') },
    organization: { reference: orgRef },
    code: [
      {
        coding: [
          {
            system: 'https://fhir.hl7.org.uk/STU3/CodeSystem/CareConnect-SDSJobRoleName-1',
            display: p.role,
          },
        ],
      },
    ],
  }

  return { fullUrl, resource }
}

function makeLocation(l: DraftRecord['locations'][number], map: TempIdMap): fhir3.BundleEntry {
  const { id, fullUrl } = map.entry(l._tempId)

  const resource: fhir3.Location = {
    resourceType: 'Location',
    id,
    ...(l.name ? { name: l.name } : {}),
    ...(l.address ? { address: { text: l.address } } : {}),
  }

  return { fullUrl, resource }
}

export function generateAdmin(draft: DraftRecord, map: TempIdMap): fhir3.BundleEntry[] {
  const orgRef = map.ref(draft.organisation._tempId, 'Organization')
  const practitionerRoles = draft.practitioners
    .map(p => makePractitionerRole(p, orgRef, map))
    .filter((e): e is fhir3.BundleEntry => e !== undefined)

  return [
    makePatient(draft, map),
    makeOrg(draft.organisation, map),
    ...(draft.organisations ?? []).map(o => makeOrg(o, map)),
    ...draft.practitioners.map(p => makePractitioner(p, map)),
    ...practitionerRoles,
    ...draft.locations.map(l => makeLocation(l, map)),
  ]
}
