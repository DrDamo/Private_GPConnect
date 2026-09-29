import type * as fhir3 from 'fhir/r3'
import type { HtmlSection } from '@pgpc/core'
import { AdapterError } from './errors'
import type { GpConnectEndpoint } from './sds'

// GP Connect Access Record: HTML ($gpc.getcarerecord), version 0.7.x.
//
// This interface is FHIR DSTU2 (1.0.2), unlike Access Record: Structured,
// which is STU3. The request is built here exactly as it is sent through the
// Spine Secure Proxy (JWT + Ssp-* headers + Parameters body), and the response
// Bundle is parsed here too, so the simulator and a future real transport
// share all of the protocol code.
//
// Verified against a real request/response pair from the GP Connect
// Demonstrator (0.7.2), kept in packages/fixtures/gpconnect-examples/html/.
// The STU3 typings below are used loosely: the fields we read and write have
// the same names in DSTU2, and JWT resources are typed as plain objects.

export const INTERACTION_GET_CARE_RECORD = 'urn:nhs:names:services:gpconnect:fhir:operation:gpc.getcarerecord'
export const RECORD_SECTION_SYSTEM = 'http://fhir.nhs.net/ValueSet/gpconnect-record-section-1'
export const GPC_NHS_NUMBER_SYSTEM = 'http://fhir.nhs.net/Id/nhs-number'
export const SDS_USER_ID_SYSTEM = 'http://fhir.nhs.net/sds-user-id'
export const ODS_CODE_SYSTEM = 'http://fhir.nhs.net/Id/ods-organization-code'
export const SDS_JOB_ROLE_SYSTEM = 'http://fhir.nhs.net/ValueSet/sds-job-role-name-1'
/** 0.7.x: `aud` is this fixed value, not the request URL (confirmed by the real example). */
export const GPC_07_AUDIENCE = 'https://authorize.fhir.nhs.net/token'

// GP Connect 1.x (STU3) identifier namespaces.
export const SDS_USER_ID_SYSTEM_1X = 'https://fhir.nhs.uk/Id/sds-user-id'
export const ODS_CODE_SYSTEM_1X = 'https://fhir.nhs.uk/Id/ods-organization-code'

const LOCAL_SYSTEM = 'https://private-gpconnect.sim.invalid/Id'

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

type Identifier = { system?: string; value?: string }

/** JWT claims. The embedded resources are DSTU2-shaped for 0.7.x and STU3-shaped for 1.x. */
export interface GpConnectJwtClaims {
  iss: string
  sub: string
  aud: string
  exp: number
  iat: number
  reason_for_request: 'directcare'
  requested_record: { resourceType: 'Patient'; identifier?: Identifier[] }
  requested_scope: 'patient/*.read'
  requesting_device: { resourceType: 'Device'; id?: string; identifier?: Identifier[]; model?: string; version?: string }
  requesting_organization: { resourceType: 'Organization'; id?: string; identifier?: Identifier[]; name?: string }
  requesting_practitioner: {
    resourceType: 'Practitioner'
    id?: string
    identifier?: Identifier[]
    name?: unknown
    practitionerRole?: unknown[]
  }
}

/** GP Connect interface version, which decides the JWT's shape. */
export type GpcVersion = '0.7' | '1.x'

/**
 * The checks a GP Connect producer applies to the JWT. Returns every problem
 * found (empty when valid). Used by the simulated GP system, and tested
 * against the real Demonstrator example so the rules stay honest.
 */
export function checkJwtClaims(claims: GpConnectJwtClaims, ctx: { version: GpcVersion; url: string; now: Date }): string[] {
  const problems: string[] = []
  const nowS = Math.floor(ctx.now.getTime() / 1000)
  const v07 = ctx.version === '0.7'
  const expectedAud = v07 ? GPC_07_AUDIENCE : ctx.url
  if (claims.aud !== expectedAud) problems.push(`aud must be ${expectedAud}`)
  if (!(claims.exp > nowS)) problems.push('JWT has expired')
  if (claims.exp - claims.iat > 300) problems.push('JWT lifetime must not exceed 5 minutes')
  if (claims.iat > nowS + 60) problems.push('JWT issued in the future')
  if (claims.reason_for_request !== 'directcare') problems.push('reason_for_request must be directcare')
  if (claims.requested_scope !== 'patient/*.read') problems.push('requested_scope must be patient/*.read')
  if (claims.requested_record?.resourceType !== 'Patient' || !claims.requested_record.identifier?.[0]?.value) {
    problems.push('requested_record must identify a Patient')
  }
  if (claims.requesting_device?.resourceType !== 'Device') problems.push('requesting_device is required')
  const odsSystem = v07 ? ODS_CODE_SYSTEM : ODS_CODE_SYSTEM_1X
  if (!claims.requesting_organization?.identifier?.some(i => i.system === odsSystem && i.value)) {
    problems.push('requesting_organization needs an ODS code')
  }
  const sdsSystem = v07 ? SDS_USER_ID_SYSTEM : SDS_USER_ID_SYSTEM_1X
  if (!claims.requesting_practitioner?.identifier?.some(i => i.system === sdsSystem && i.value)) {
    problems.push('requesting_practitioner needs an SDS user id')
  }
  if (!claims.requesting_practitioner?.id || claims.sub !== claims.requesting_practitioner.id) {
    problems.push('sub must equal requesting_practitioner.id')
  }
  return problems
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

function splitName(name: string) {
  const clean = name.replace(/\s*\(.*\)$/, '')
  const prefix = /^(Dr|Mr|Mrs|Ms|Miss)\s+/.exec(clean)?.[1]
  const [given, ...rest] = clean.replace(/^(Dr|Mr|Mrs|Ms|Miss)\s+/, '').split(' ')
  return { prefix, given: rest.length ? [given] : [], family: rest.join(' ') || given }
}

export function buildJwtClaims(input: {
  version: GpcVersion
  /** Request URL; used as `aud` for 1.x only. */
  url: string
  nhsNumber: string
  nhsNumberSystem: string
  requester: Requester
  now: Date
}): GpConnectJwtClaims {
  const now = Math.floor(input.now.getTime() / 1000)
  const { user, organisation } = input.requester
  const n = splitName(user.name)
  const v07 = input.version === '0.7'
  return {
    iss: 'https://private-gpconnect.sim.invalid/',
    // sub must equal requesting_practitioner.id
    sub: user.userId,
    // ⚠ 1.x: using the request URL is unverified; 0.7.x is confirmed.
    aud: v07 ? GPC_07_AUDIENCE : input.url,
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
      id: '1',
      identifier: [{ system: `${LOCAL_SYSTEM}/local-system-instance-id`, value: 'private-gpconnect-middleware' }],
      model: 'Private GP Connect middleware',
      version: '0.1.0',
    },
    requesting_organization: {
      resourceType: 'Organization',
      id: '1',
      identifier: [{ system: v07 ? ODS_CODE_SYSTEM : ODS_CODE_SYSTEM_1X, value: organisation.odsCode }],
      name: organisation.name,
    },
    requesting_practitioner: {
      resourceType: 'Practitioner',
      id: user.userId,
      identifier: [
        { system: v07 ? SDS_USER_ID_SYSTEM : SDS_USER_ID_SYSTEM_1X, value: user.userId },
        { system: `${LOCAL_SYSTEM}/local-user-id`, value: user.userId },
        ...(user.professionalRegistration ? [{ system: `${LOCAL_SYSTEM}/professional-registration`, value: user.professionalRegistration }] : []),
      ],
      // DSTU2 HumanName (single, family as an array) for 0.7.x; STU3 (array, family a string) for 1.x.
      name: v07
        ? { family: [n.family], given: n.given, ...(n.prefix ? { prefix: [n.prefix] } : {}) }
        : [{ family: n.family, given: n.given, ...(n.prefix ? { prefix: [n.prefix] } : {}) }],
      ...(v07
        ? {
            // ⚠ Placeholder job role, as in the Demonstrator's own example. A
            // real consumer sends the user's SDS job role code.
            practitionerRole: [{ role: { coding: [{ system: SDS_JOB_ROLE_SYSTEM, code: 'sds-job-role-name' }] } }],
          }
        : {}),
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
  const claims = buildJwtClaims({ version: '0.7', url, nhsNumber: input.nhsNumber, nhsNumberSystem: GPC_NHS_NUMBER_SYSTEM, requester: input.requester, now: input.now ?? new Date() })
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
  const org = resources.find(
    (r): r is fhir3.Organization => r.resourceType === 'Organization' && Boolean(r.identifier?.some(i => i.system === ODS_CODE_SYSTEM)),
  ) ?? resources.find((r): r is fhir3.Organization => r.resourceType === 'Organization')
  return {
    section,
    title: s.title ?? section,
    html: s.text.div,
    generatedAt: composition.date,
    practice: org ? { odsCode: org.identifier?.[0]?.value, name: org.name } : undefined,
  }
}

/** An HTTP response from a GP system (or the Spine Secure Proxy). */
export interface GpConnectResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

/**
 * Sends a built request and returns the HTTP response. Throws AdapterError
 * only for transport-level failures (no service, timeout); a GP system's own
 * errors come back as OperationOutcome bodies.
 */
export type GpConnectTransport = (exchange: GpConnectExchange) => Promise<GpConnectResponse>

// 0.7.x error OperationOutcome (confirmed by a real PATIENT_NOT_FOUND example).
export const GPC_07_ERROR_SYSTEM = 'http://fhir.nhs.net/ValueSet/gpconnect-error-or-warning-code-1'
export const GPC_07_OO_PROFILE = 'http://fhir.nhs.net/StructureDefinition/gpconnect-operationoutcome-1'
// ⚠ 1.x (STU3) equivalents: unverified.
export const GPC_1X_ERROR_SYSTEM = 'https://fhir.nhs.uk/STU3/CodeSystem/Spine-ErrorOrWarningCode-1'
export const GPC_1X_OO_PROFILE = 'https://fhir.nhs.uk/STU3/StructureDefinition/GPConnect-OperationOutcome-1'

export function gpConnectOperationOutcome(
  version: GpcVersion,
  e: { issueCode: string; gpConnectCode: string; diagnostics: string },
): fhir3.OperationOutcome {
  const v07 = version === '0.7'
  return {
    resourceType: 'OperationOutcome',
    meta: { profile: [v07 ? GPC_07_OO_PROFILE : GPC_1X_OO_PROFILE] },
    issue: [
      {
        severity: 'error',
        code: e.issueCode as fhir3.OperationOutcomeIssue['code'],
        details: { coding: [{ system: v07 ? GPC_07_ERROR_SYSTEM : GPC_1X_ERROR_SYSTEM, code: e.gpConnectCode, display: e.gpConnectCode }] },
        diagnostics: e.diagnostics,
      },
    ],
  }
}

const STATUS_TO_CODE = (status: number): AdapterError['code'] =>
  status === 404 ? 'not-found' : status === 401 || status === 403 ? 'unauthorised' : status >= 500 ? 'unavailable' : 'invalid-request'

/**
 * Turns a GP system response into a Bundle, or an AdapterError that carries
 * the GP Connect error code and diagnostics from the OperationOutcome.
 */
export function interpretGpConnectResponse(res: GpConnectResponse): fhir3.Bundle {
  const body = res.body as { resourceType?: string } | null
  if (res.status >= 200 && res.status < 300 && body?.resourceType === 'Bundle') return body as fhir3.Bundle
  if (body?.resourceType === 'OperationOutcome') {
    const issue = (body as fhir3.OperationOutcome).issue?.[0]
    const gpConnectCode = issue?.details?.coding?.[0]?.code ?? 'UNKNOWN'
    const diagnostics = issue?.diagnostics ?? ''
    throw new AdapterError('gp-connect', STATUS_TO_CODE(res.status), `${gpConnectCode}${diagnostics ? `: ${diagnostics}` : ''}`, {
      httpStatus: res.status,
      gpConnectCode,
      ...(diagnostics ? { diagnostics } : {}),
    })
  }
  throw new AdapterError('gp-connect', STATUS_TO_CODE(res.status || 502), `Unexpected response (HTTP ${res.status})`, { httpStatus: res.status })
}

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
    const bundle = interpretGpConnectResponse(await this.transport(exchange))
    return { record: parseCareRecordResponse(bundle, input.section), exchange }
  }
}
