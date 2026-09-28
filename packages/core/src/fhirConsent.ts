import type { ConsentRecord } from './consent'

// Renders a consent as a FHIR R4 Consent resource (hl7.org/fhir/R4/consent.html)
// for the provider API and for export. Kept deliberately minimal; this is a
// view of the internal record, not a UK Core-conformant profile.

type FhirConsentStatus = 'draft' | 'proposed' | 'active' | 'rejected' | 'inactive' | 'entered-in-error'

const STATUS_MAP: Record<ConsentRecord['status'], FhirConsentStatus> = {
  pending: 'proposed',
  active: 'active',
  declined: 'rejected',
  withdrawn: 'inactive',
  expired: 'inactive',
}

export function toFhirConsent(record: ConsentRecord) {
  return {
    resourceType: 'Consent' as const,
    id: record.id,
    meta: { versionId: String(record.version) },
    status: STATUS_MAP[record.status],
    scope: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }],
    },
    category: [{ coding: [{ system: 'http://loinc.org', code: '59284-0', display: 'Patient Consent' }] }],
    patient: { identifier: { system: 'https://fhir.nhs.uk/Id/nhs-number', value: record.patient.nhsNumber } },
    dateTime: record.decision?.at ?? record.requestedAt,
    organization: [
      {
        identifier: { system: 'https://fhir.nhs.uk/Id/ods-organization-code', value: record.provider.odsCode },
        display: record.provider.name,
      },
    ],
    policyRule: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'OPTIN' }],
    },
    provision: {
      type: 'permit' as const,
      ...(record.validFrom ? { period: { start: record.validFrom, end: record.expiresAt } } : {}),
      purpose: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT', display: record.episode.purpose }],
      action: record.scope.actions.map(a => ({ text: a })),
      data: [
        ...record.scope.htmlSections.map(s => ({ meaning: 'instance' as const, reference: { display: `html:${s}` } })),
        ...record.scope.clinicalAreas.map(c => ({ meaning: 'instance' as const, reference: { display: `structured:${c}` } })),
      ],
    },
  }
}
