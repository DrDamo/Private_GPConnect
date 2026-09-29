import type * as fhir3 from 'fhir/r3'
import type { PdsPatient } from './pds'

// GP Connect Send Document: a provider sends the patient's GP practice a
// document (here, a summary of care or a supply/prescription notification) as a
// FHIR STU3 message Bundle over MESH.
//
// ⚠ UNVERIFIED: the Bundle structure, the MessageHeader event and the MESH
// workflow id below are our reading of the Send Document specification. Check
// them against a real example before any real integration.

export const SEND_DOCUMENT_WORKFLOW_ID = 'GPFED_CONSULT_REPORT'
export const SEND_DOCUMENT_EVENT = { system: 'https://fhir.nhs.uk/STU3/CodeSystem/GPConnect-MessageEvent-1', code: 'SEND_DOCUMENT' }

export type DocumentKind = 'supply-notification' | 'care-summary'

export interface SuppliedMedicine {
  name: string
  /** Exactly as the prescriber wrote it. */
  dosageInstruction: string
  quantity: string
  date: string
}

export interface OutboundDocument {
  kind: DocumentKind
  title: string
  date: string
  summary: string
  medicines: SuppliedMedicine[]
  adviceForGp?: string
}

export interface DocumentAuthor {
  user: { userId: string; name: string; professionalRegistration?: string }
  organisation: { odsCode: string; name: string }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The human-readable document the GP practice files (HTML; a real service would likely send PDF). */
export function renderDocumentHtml(doc: OutboundDocument, patient: PdsPatient, patientName: string, author: DocumentAuthor): string {
  const meds = doc.medicines.length
    ? `<h2>Medicines supplied or prescribed</h2><table><thead><tr><th>Date</th><th>Medicine</th><th>Dosage instruction</th><th>Quantity</th></tr></thead><tbody>${doc.medicines
        .map(m => `<tr><td>${esc(m.date)}</td><td>${esc(m.name)}</td><td>${esc(m.dosageInstruction)}</td><td>${esc(m.quantity)}</td></tr>`)
        .join('')}</tbody></table>`
    : ''
  return [
    `<h1>${esc(doc.title)}</h1>`,
    `<p><strong>Patient:</strong> ${esc(patientName)} · NHS number ${esc(patient.nhsNumber)} · born ${esc(patient.birthDate ?? 'unknown')}</p>`,
    `<p><strong>From:</strong> ${esc(author.user.name)}${author.user.professionalRegistration ? ` (${esc(author.user.professionalRegistration)})` : ''}, ${esc(author.organisation.name)} (${esc(author.organisation.odsCode)})</p>`,
    `<p><strong>Date:</strong> ${esc(doc.date)}</p>`,
    `<h2>Summary</h2><p>${esc(doc.summary).replace(/\n/g, '<br>')}</p>`,
    meds,
    doc.adviceForGp ? `<h2>Advice for the GP</h2><p>${esc(doc.adviceForGp).replace(/\n/g, '<br>')}</p>` : '',
    `<p><em>Sent with the patient's consent through a private GP Connect service (SIMULATION).</em></p>`,
  ].join('')
}

export function buildSendDocumentBundle(input: {
  doc: OutboundDocument
  patient: PdsPatient
  patientName: string
  author: DocumentAuthor
  recipientOdsCode: string
  messageId: string
  now: Date
}): fhir3.Bundle {
  const { doc, patient, author } = input
  const html = renderDocumentHtml(doc, patient, input.patientName, author)
  const ids = { patient: 'patient', sender: 'sender', recipient: 'recipient', author: 'author', binary: 'document-binary', docref: 'document-reference' }
  return {
    resourceType: 'Bundle',
    id: input.messageId,
    type: 'message',
    entry: [
      {
        fullUrl: 'urn:uuid:message-header',
        resource: {
          resourceType: 'MessageHeader',
          event: SEND_DOCUMENT_EVENT,
          timestamp: input.now.toISOString(),
          source: { endpoint: 'urn:private-gpconnect:sim', name: 'Private GP Connect middleware (simulated)' },
          sender: { reference: `Organization/${ids.sender}` },
          destination: [{ endpoint: `urn:nhs:ods:${input.recipientOdsCode}`, receiver: { reference: `Organization/${ids.recipient}` } } as fhir3.MessageHeaderDestination],
          focus: [{ reference: `DocumentReference/${ids.docref}` }],
        } as unknown as fhir3.MessageHeader,
      },
      {
        fullUrl: `DocumentReference/${ids.docref}`,
        resource: {
          resourceType: 'DocumentReference',
          id: ids.docref,
          status: 'current',
          type: {
            coding: [{ system: 'http://snomed.info/sct', code: '371531000', display: 'Report of clinical encounter' }],
            text: doc.title,
          },
          subject: { reference: `Patient/${ids.patient}` },
          indexed: input.now.toISOString(),
          author: [{ reference: `Practitioner/${ids.author}` }, { reference: `Organization/${ids.sender}` }],
          description: doc.title,
          content: [{ attachment: { contentType: 'text/html', url: `Binary/${ids.binary}`, title: doc.title, creation: doc.date } }],
        } as fhir3.DocumentReference,
      },
      {
        fullUrl: `Binary/${ids.binary}`,
        resource: { resourceType: 'Binary', id: ids.binary, contentType: 'text/html', content: Buffer.from(html, 'utf8').toString('base64') } as fhir3.Binary,
      },
      {
        fullUrl: `Patient/${ids.patient}`,
        resource: {
          resourceType: 'Patient',
          id: ids.patient,
          identifier: [{ system: 'https://fhir.nhs.uk/Id/nhs-number', value: patient.nhsNumber }],
          ...(patient.birthDate ? { birthDate: patient.birthDate } : {}),
          ...(patient.name ? { name: [{ family: patient.name.family, given: patient.name.given }] } : {}),
        } as fhir3.Patient,
      },
      {
        fullUrl: `Practitioner/${ids.author}`,
        resource: {
          resourceType: 'Practitioner',
          id: ids.author,
          identifier: [{ system: 'https://private-gpconnect.sim.invalid/Id/local-user-id', value: author.user.userId }],
          name: [{ text: author.user.name }],
        } as fhir3.Practitioner,
      },
      {
        fullUrl: `Organization/${ids.sender}`,
        resource: {
          resourceType: 'Organization',
          id: ids.sender,
          identifier: [{ system: 'https://fhir.nhs.uk/Id/ods-organization-code', value: author.organisation.odsCode }],
          name: author.organisation.name,
        } as fhir3.Organization,
      },
      {
        fullUrl: `Organization/${ids.recipient}`,
        resource: {
          resourceType: 'Organization',
          id: ids.recipient,
          identifier: [{ system: 'https://fhir.nhs.uk/Id/ods-organization-code', value: input.recipientOdsCode }],
        } as fhir3.Organization,
      },
    ],
  }
}

/** Reads the human-readable document back out of a Send Document Bundle (practice side). */
export function readSendDocumentBundle(bundle: fhir3.Bundle): { title: string; html: string; nhsNumber?: string; senderOds?: string } {
  const res = (bundle.entry ?? []).map(e => e.resource as fhir3.FhirResource)
  const docRef = res.find((r): r is fhir3.DocumentReference => r.resourceType === 'DocumentReference')
  const binary = res.find((r): r is fhir3.Binary => r.resourceType === 'Binary')
  const patient = res.find((r): r is fhir3.Patient => r.resourceType === 'Patient')
  const sender = res.find((r): r is fhir3.Organization => r.resourceType === 'Organization' && r.id === 'sender')
  return {
    title: docRef?.description ?? docRef?.type?.text ?? 'Document',
    html: binary?.content ? Buffer.from(binary.content, 'base64').toString('utf8') : '',
    nhsNumber: patient?.identifier?.[0]?.value,
    senderOds: sender?.identifier?.[0]?.value,
  }
}
