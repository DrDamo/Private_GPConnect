import { describe, expect, it } from 'vitest'
import type { HtmlSection } from '@pgpc/core'
import { MIDDLEWARE } from '@pgpc/fixtures'
import {
  AdapterError,
  buildCareRecordRequest,
  decodeUnsignedJwt,
  encodeUnsignedJwt,
  GpConnectHtmlClient,
  MockSds,
  simulatedGpSystems,
  type GpConnectExchange,
  type GpConnectJwtClaims,
} from '../src'

const NOW = new Date('2026-10-01T09:00:00Z')
const requester = {
  user: { userId: 'sim-user-ph-pharm', name: 'Priya Desai (Pharmacist)', professionalRegistration: 'SIM-GPhC-0001' },
  organisation: { odsCode: 'SIMPH1', name: 'Northern Online Pharmacy (simulated)' },
}
const sds = new MockSds()
const client = new GpConnectHtmlClient(simulatedGpSystems({ clock: () => NOW }), MIDDLEWARE, () => NOW)

async function fetchSection(nhsNumber: string, ods: string, section: HtmlSection = 'SUM') {
  const endpoint = (await sds.getGpConnectEndpoint(ods))!
  return client.getCareRecord({ nhsNumber, section, endpoint, requester, traceId: 'trace-1' })
}

const rejectsWith = (p: Promise<unknown>, code: string, message?: RegExp) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof AdapterError && e.code === code && (!message || message.test(e.message)))

describe('unsigned JWT', () => {
  it('round-trips and rejects anything signed or malformed', () => {
    const t = encodeUnsignedJwt({ a: 1 })
    expect(t.endsWith('.')).toBe(true)
    expect(decodeUnsignedJwt(t)).toEqual({ a: 1 })
    expect(decodeUnsignedJwt(t + 'sig')).toBeNull()
    const hs256 = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.`
    expect(decodeUnsignedJwt(hs256)).toBeNull()
    expect(decodeUnsignedJwt('garbage')).toBeNull()
  })
})

describe('buildCareRecordRequest', () => {
  it('sets Spine headers and GP Connect claims', async () => {
    const endpoint = (await sds.getGpConnectEndpoint('SIMGP1'))!
    const ex = buildCareRecordRequest({ nhsNumber: '9990000018', section: 'MED', endpoint, requester, consumer: MIDDLEWARE, traceId: 't', now: NOW })
    expect(ex.headers).toMatchObject({
      'Ssp-TraceID': 't',
      'Ssp-From': MIDDLEWARE.asid,
      'Ssp-To': endpoint.asid,
      'Ssp-InteractionID': 'urn:nhs:names:services:gpconnect:fhir:operation:gpc.getcarerecord',
    })
    expect(ex.url).toMatch(/\/Patient\/\$gpc\.getcarerecord$/)
    const claims = decodeUnsignedJwt<GpConnectJwtClaims>(ex.headers.Authorization.replace('Bearer ', ''))!
    expect(claims).toMatchObject({ aud: 'https://authorize.fhir.nhs.net/token', reason_for_request: 'directcare', sub: 'sim-user-ph-pharm', requested_scope: 'patient/*.read' })
    expect(claims.exp - claims.iat).toBe(300)
    expect(claims.requesting_organization.identifier?.[0]?.value).toBe('SIMPH1')
    expect(claims.requesting_practitioner.name).toEqual({ family: ['Desai'], given: ['Priya'] })
    expect(ex.body.parameter?.[1]?.valueCodeableConcept?.coding?.[0]?.code).toBe('MED')
  })
})

describe('GpConnectHtmlClient with simulated GP systems', () => {
  it('returns the requested section as HTML with practice details', async () => {
    const { record, exchange } = await fetchSection('9990000050', 'SIMGP2', 'MED')
    expect(record).toMatchObject({ section: 'MED', title: 'Medications', practice: { odsCode: 'SIMGP2' }, generatedAt: NOW.toISOString() })
    expect(record.html).toContain('Warfarin 1mg tablets')
    expect(record.html).toContain('<th>Dosage Instruction</th>')
    expect(exchange.headers['Ssp-To']).toBe('900000000102')
  })

  it('shows allergies and "no data" messages', async () => {
    expect((await fetchSection('9990000050', 'SIMGP2', 'ALL')).record.html).toContain('Allergy to Penicillin, Widespread rash')
    expect((await fetchSection('9990000115', 'SIMGP2', 'PRB')).record.html).toContain("No 'Active Problems and Issues' data is recorded for this patient.")
  })

  it('withholds confidential items and shows the exclusion banner', async () => {
    const { record } = await fetchSection('9990000123', 'SIMGP1', 'PRB')
    expect(record.html).toContain('Items excluded due to confidentiality')
    expect(record.html).not.toContain('Termination of pregnancy')
  })

  it('escapes content so fixture text cannot inject markup', async () => {
    const { record } = await fetchSection('9990000018', 'SIMGP1', 'OBS')
    expect(record.html).toContain('kg/m²')
    expect(record.html).not.toMatch(/<script/i)
  })

  it('404s a patient not registered at the practice', async () => {
    await rejectsWith(fetchSection('9990000026', 'SIMGP1'), 'not-found')
  })

  it('reports unavailable for a practice without GP Connect', async () => {
    const transport = simulatedGpSystems({ clock: () => NOW })
    const endpoint = { odsCode: 'SIMGP4', asid: '900000000104', partyKey: 'x', address: 'https://simgp4.gpconnect.sim.invalid/STU3/1/gpconnect/structured/fhir', supplier: 'TPP' as const }
    await rejectsWith(new GpConnectHtmlClient(transport, MIDDLEWARE, () => NOW).getCareRecord({ nhsNumber: '9990000107', section: 'SUM', endpoint, requester, traceId: 't' }), 'unavailable')
  })
})

describe('simulated producer validates requests like a real one', () => {
  const transport = simulatedGpSystems({ clock: () => NOW })
  async function good(): Promise<GpConnectExchange> {
    const endpoint = (await sds.getGpConnectEndpoint('SIMGP1'))!
    return buildCareRecordRequest({ nhsNumber: '9990000018', section: 'SUM', endpoint, requester, consumer: MIDDLEWARE, traceId: 't', now: NOW })
  }
  const withClaims = (ex: GpConnectExchange, patch: Partial<GpConnectJwtClaims>): GpConnectExchange => ({
    ...ex,
    headers: { ...ex.headers, Authorization: `Bearer ${encodeUnsignedJwt({ ...ex.jwtClaims, ...patch })}` },
  })

  it('accepts a well-formed request', async () => {
    await expect(transport(await good())).resolves.toMatchObject({ resourceType: 'Bundle' })
  })

  it.each([
    ['wrong interaction', (ex: GpConnectExchange) => ({ ...ex, headers: { ...ex.headers, 'Ssp-InteractionID': 'urn:x' } }), /InteractionID/],
    ['wrong Ssp-To', (ex: GpConnectExchange) => ({ ...ex, headers: { ...ex.headers, 'Ssp-To': '900000000102' } }), /Ssp-To/],
    ['no JWT', (ex: GpConnectExchange) => ({ ...ex, headers: { ...ex.headers, Authorization: '' } }), /JWT/],
    ['wrong audience', (ex: GpConnectExchange) => withClaims(ex, { aud: 'https://elsewhere' }), /aud/],
    ['sub not the practitioner', (ex: GpConnectExchange) => withClaims(ex, { sub: 'someone-else' }), /sub must equal/],
    ['expired', (ex: GpConnectExchange) => withClaims(ex, { exp: Math.floor(NOW.getTime() / 1000) - 1 }), /expired/],
    ['not direct care', (ex: GpConnectExchange) => withClaims(ex, { reason_for_request: 'secondaryuses' as 'directcare' }), /directcare/],
    [
      'JWT for a different patient',
      (ex: GpConnectExchange) => withClaims(ex, { requested_record: { resourceType: 'Patient', identifier: [{ value: '9990000026' }] } }),
      /requested_record/,
    ],
  ])('rejects %s', async (_, mutate, message) => {
    await expect(transport(mutate(await good()))).rejects.toSatisfy(
      (e: unknown) => e instanceof AdapterError && message.test(e.message),
    )
  })
})
