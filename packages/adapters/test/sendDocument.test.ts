import type * as fhir3 from 'fhir/r3'
import { describe, expect, it } from 'vitest'
import { AdapterError, buildSendDocumentBundle, InMemoryMeshStore, MockMesh, MockPds, readSendDocumentBundle, SEND_DOCUMENT_WORKFLOW_ID } from '../src'

const NOW = new Date('2026-10-01T09:00:00Z')
const author = {
  user: { userId: 'sim-user-wm-doc', name: 'Dr Helen Carter', professionalRegistration: 'SIM-GMC-0002' },
  organisation: { odsCode: 'SIMWM1', name: 'Balance Weight Clinic (simulated)' },
}

async function bundle(overrides: Partial<Parameters<typeof buildSendDocumentBundle>[0]['doc']> = {}) {
  const patient = await new MockPds().getPatient('9990000034')
  return buildSendDocumentBundle({
    doc: {
      kind: 'supply-notification',
      title: 'Notification of medicine supplied or prescribed',
      date: '2026-10-01',
      summary: 'Assessed for weight management. Started a GLP-1 receptor agonist.',
      medicines: [{ name: 'Semaglutide 0.25mg/0.19ml pen', dosageInstruction: 'Inject 0.25mg once weekly', quantity: '1 pen', date: '2026-10-01' }],
      adviceForGp: 'Please note the past eating disorder; we will review monthly.',
      ...overrides,
    },
    patient,
    patientName: 'Ms Priya SHARMA',
    author,
    recipientOdsCode: 'SIMGP1',
    messageId: 'msg-1',
    now: NOW,
  })
}

describe('Send Document bundle', () => {
  it('is an STU3 message Bundle with header, document reference, binary, patient, author and organisations', async () => {
    const b = await bundle()
    expect(b.type).toBe('message')
    const types = b.entry!.map(e => (e.resource as fhir3.FhirResource).resourceType)
    expect(types[0]).toBe('MessageHeader')
    expect(new Set(types)).toEqual(new Set(['MessageHeader', 'DocumentReference', 'Binary', 'Patient', 'Practitioner', 'Organization']))
    const patient = b.entry!.find(e => (e.resource as fhir3.FhirResource).resourceType === 'Patient')!.resource as fhir3.Patient
    expect(patient.identifier?.[0]).toEqual({ system: 'https://fhir.nhs.uk/Id/nhs-number', value: '9990000034' })
  })

  it('round-trips the human-readable document, keeping the dosage exactly as written', async () => {
    const doc = readSendDocumentBundle(await bundle())
    expect(doc).toMatchObject({ title: 'Notification of medicine supplied or prescribed', nhsNumber: '9990000034', senderOds: 'SIMWM1' })
    expect(doc.html).toContain('Inject 0.25mg once weekly')
    expect(doc.html).toContain('Please note the past eating disorder')
    expect(doc.html).toContain('SIM-GMC-0002')
  })

  it('escapes provider-entered text', async () => {
    const doc = readSendDocumentBundle(await bundle({ summary: '<script>alert(1)</script> & more' }))
    expect(doc.html).not.toContain('<script>')
    expect(doc.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more')
  })
})

describe('MockMesh', () => {
  it('finds mailboxes only for practices that accept Send Document', async () => {
    const mesh = new MockMesh(new InMemoryMeshStore())
    expect(await mesh.lookupMailbox('SIMGP1', SEND_DOCUMENT_WORKFLOW_ID)).toBe('SIMGP1OT001')
    expect(await mesh.lookupMailbox('SIMGP4', SEND_DOCUMENT_WORKFLOW_ID)).toBeNull()
    expect(await mesh.lookupMailbox('NOPE', SEND_DOCUMENT_WORKFLOW_ID)).toBeNull()
  })

  it('delivers to the practice inbox and tracks status', async () => {
    const store = new InMemoryMeshStore()
    const mesh = new MockMesh(store, { clock: () => NOW })
    const { messageId } = await mesh.send({ from: 'SIMMW1OT001', to: 'SIMGP1OT001', workflowId: SEND_DOCUMENT_WORKFLOW_ID, localId: 'c-1', subject: 'Doc', contentType: 'application/fhir+json', content: await bundle() })
    expect(await mesh.status(messageId)).toEqual({ status: 'accepted', statusAt: NOW.toISOString() })
    expect((await store.listForMailbox('SIMGP1OT001', 10)).map(m => m.id)).toEqual([messageId])
    await store.setStatus(messageId, 'acknowledged', NOW.toISOString(), 'Filed in patient record')
    expect(await mesh.status(messageId)).toMatchObject({ status: 'acknowledged', statusNote: 'Filed in patient record' })
  })

  it('refuses an unknown mailbox', async () => {
    const mesh = new MockMesh(new InMemoryMeshStore())
    await expect(
      mesh.send({ from: 'x', to: 'NOPEOT001', workflowId: SEND_DOCUMENT_WORKFLOW_ID, localId: 'c', subject: 's', contentType: 't', content: {} }),
    ).rejects.toBeInstanceOf(AdapterError)
  })
})
