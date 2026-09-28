import type * as fhir3 from 'fhir/r3'
import type { HtmlSection } from '@pgpc/core'
import { AdapterError } from './errors'
import type { GpConnectEndpoint } from './sds'

// GP Connect Access Record: HTML ($gpc.getcarerecord).
//
// The request is built here exactly as it would be sent through the Spine
// Secure Proxy (JWT + Ssp-* headers + Parameters body), and the response
// Bundle is parsed here too, so the simulator and a future real transport
// share all of the protocol code.
//
// ⚠ Shapes follow our reading of the GP Connect Access Record HTML
// specification (https://developer.nhs.uk/apis/gpconnect-0-7-2/) and must be
// verified against the version in use before any real integration.

export const INTERACTION_GET_CARE_RECORD = 'urn:nhs:names:services:gpconnect:fhir:operation:gpc.getcarerecord'
export const RECORD_SECTION_SYSTEM = 'http://fhir.nhs.net/ValueSet/gpconnect-record-section-1'
export const GPC_NHS_NUMBER_SYSTEM = 'http://fhir.nhs.net/Id/nhs-number'
export const SDS_USER_ID_SYSTEM = 'http://fhir.nhs.net/sds-user-id'
export const ODS_CODE_SYSTEM = 'http://fhir.nhs.net/Id/ods-organization-code'

export interface Requester {
  user: { userId: string; name: string; professionalRegistration?: string }
  organisation: { odsCode: string; name: string }
}

export interface Consumer {
  asid: string
  odsCode: string
}

export interface GpConnectExchange {
  url: string
  headers: Record<string, string>
  /** Decoded JWT claims, for inspection. */
  jwtClaims: GpConnectJwtClaims
  body: fhir3.Parameters
}

export interface GpConnectJwtClaims {
  iss: string
  sub: string
  aud: string
  exp: number
  iat: number
  reason_for_request: 'directcare'
  requested_record: fhir3.Patient
  requested_scope: 'patient/*.read'
  requesting_device: fhir3.Device
  requesting_organization: fhir3.Organization
  requesting_practitioner: fhir3.Practitioner
}

const b64url = (s: string) => Buffer.from(s).toString('base64url')

/** GP Connect uses unsigned JWTs (alg "none"); identity is asserted by the consumer system. */
export function encodeUnsignedJwt(claims: object): string {
  return `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.`
}

export function decodeUnsignedJwt<T>(token: string): T | null {
  const [header, payload, sig, ...rest] = token.split('.')
  if (!header || !payload || sig !== '' || rest.length) return null
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: string }
    if (h.alg !== 'none') return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

export function buildJwtClaims(input: {
  aud: string
  nhsNumber: string
  nhsNumberSystem: string
  requester: Requester
  now: Date
}): GpConnectJwtClaims {
  const now = Math.floor(input.now.getTime() / 1000)
  const [given, ...rest] = input.requester.user.name.replace(/\s*\(.*\)$/, '').replace(/^Dr\s+/, '').split(' ')
  return {
    iss: 'https://private-gpconnect.sim.invalid',
    sub: input.requester.user.userId,
    aud: input.aud,
    exp: now + 300,
    iat: now,
    reason_for_request: 'directcare',
    requested_record: {
      resourceType: 'Patient',
      identifier: [{ system: input.nhsNumberSystem, value: input.nhsNumber }],
    },
    requested_scope: 'patient/*.read',
    requesting_device: {
      resourceType: 'Device',
      identifier: [{ system: 'https://private-gpconnect.sim.invalid/device', value: 'middleware' }],
      model: 'Private GP Connect middleware',
      version: '0.1.0',
    },
    requesting_organization: {
      resourceType: 'Organization',
      identifier: [{ system: ODS_CODE_SYSTEM, value: input.requester.organisation.odsCode }],
      name: input.requester.organisation.name,
    },
    requesting_practitioner: {
      resourceType: 'Practitioner',
      id: input.requester.user.userId,
      identifier: [
        { system: SDS_USER_ID_SYSTEM, value: input.requester.user.userId },
        ...(input.requester.user.professionalRegistration
          ? [{ system: 'https://private-gpconnect.sim.invalid/professional-registration', value: input.requester.user.professionalRegistration }]
          : []),
      ],
      name: [{ family: rest.join(' ') || given, given: rest.length ? [given] : [] }],
    },
  }
}

export function spineHeaders(input: { traceId: string; consumer: Consumer; endpoint: GpConnectEndpoint; interactionId: string; claims: GpConnectJwtClaims }) {
  return {
    'Ssp-TraceID': input.traceId,
    'Ssp-From': input.consumer.asid,
    'Ssp-To': input.endpoint.asid,
    'Ssp-InteractionID': input.interactionId,
    Authorization: `Bearer ${encodeUnsignedJwt(input.claims)}`,
    Accept: 'application/fhir+json',
    'Content-Type': 'application/fhir+json',
  }
}

export function buildCareRecordRequest(input: {
  nhsNumber: string
  section: HtmlSection
  endpoint: GpConnectEndpoint
  requester: Requester
  consumer: Consumer
  traceId: string
  now?: Date
}): GpConnectExchange {
  const url = input.endpoint.address.replace(/\/structured\/fhir$/, '/fhir') + '/Patient/$gpc.getcarerecord'
  const claims = buildJwtClaims({ aud: url, nhsNumber: input.nhsNumber, nhsNumberSystem: GPC_NHS_NUMBER_SYSTEM, requester: input.requester, now: input.now ?? new Date() })
  return {
    url,
    jwtClaims: claims,
    headers: {
      ...spineHeaders({ traceId: input.traceId, consumer: input.consumer, endpoint: input.endpoint, interactionId: INTERACTION_GET_CARE_RECORD, claims }),
      Accept: 'application/json+fhir',
      'Content-Type': 'application/json+fhir',
    },
    body: {
      resourceType: 'Parameters',
      parameter: [
        { name: 'patientNHSNumber', valueIdentifier: { system: GPC_NHS_NUMBER_SYSTEM, value: input.nhsNumber } },
        { name: 'recordSection', valueCodeableConcept: { coding: [{ system: RECORD_SECTION_SYSTEM, code: input.section }] } },
      ],
    },
  }
}

export interface CareRecordSection {
  section: HtmlSection
  title: string
  /** Raw HTML as supplied by the GP system. Must be sanitised before display. */
  html: string
  generatedAt?: string
  practice?: { odsCode?: string; name?: string }
}

/** Extracts the requested section from a getcarerecord response Bundle. */
export function parseCareRecordResponse(bundle: fhir3.Bundle, section: HtmlSection): CareRecordSection {
  const resources = (bundle.entry ?? []).map(e => e.resource).filter(Boolean) as fhir3.FhirResource[]
  const composition = resources.find((r): r is fhir3.Composition => r.resourceType === 'Composition')
  const s = composition?.section?.find(x => x.code?.coding?.some(c => c.code === section))
  if (!composition || !s?.text?.div) {
    throw new AdapterError('gp-connect', 'invalid-request', `Response has no ${section} section`)
  }
  const org = resources.find((r): r is fhir3.Organization => r.resourceType === 'Organization')
  return {
    section,
    title: s.title ?? section,
    html: s.text.div,
    generatedAt: composition.date,
    practice: org ? { odsCode: org.identifier?.[0]?.value, name: org.name } : undefined,
  }
}

/** Sends a built request and returns the response Bundle (or throws AdapterError). */
export type GpConnectTransport = (exchange: GpConnectExchange) => Promise<fhir3.Bundle>

export interface GpConnectHtmlAdapter {
  getCareRecord(input: {
    nhsNumber: string
    section: HtmlSection
    endpoint: GpConnectEndpoint
    requester: Requester
    traceId: string
  }): Promise<{ record: CareRecordSection; exchange: GpConnectExchange }>
}

export class GpConnectHtmlClient implements GpConnectHtmlAdapter {
  private readonly transport: GpConnectTransport
  private readonly consumer: Consumer
  private readonly clock: () => Date
  constructor(transport: GpConnectTransport, consumer: Consumer, clock: () => Date = () => new Date()) {
    this.transport = transport
    this.consumer = consumer
    this.clock = clock
  }

  async getCareRecord(input: Parameters<GpConnectHtmlAdapter['getCareRecord']>[0]) {
    const exchange = buildCareRecordRequest({ ...input, consumer: this.consumer, now: this.clock() })
    const bundle = await this.transport(exchange)
    return { record: parseCareRecordResponse(bundle, input.section), exchange }
  }
}
