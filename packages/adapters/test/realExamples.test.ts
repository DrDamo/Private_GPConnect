import { readFileSync } from 'node:fs'
import type * as fhir3 from 'fhir/r3'
import { describe, expect, it } from 'vitest'
import { MIDDLEWARE, PATIENTS } from '@pgpc/fixtures'
import {
  buildCareRecordRequest,
  checkJwtClaims,
  decodeUnsignedJwt,
  MockSds,
  parseCareRecordResponse,
  simulatedGpSystems,
  type GpConnectJwtClaims,
} from '../src'

// Conformance against real GP Connect Demonstrator (0.7.2) traffic, supplied by
// the GP Connect team. See packages/fixtures/gpconnect-examples/README.md.

const dir = new URL('../../fixtures/gpconnect-examples/html/', import.meta.url)
const realRequest = JSON.parse(readFileSync(new URL('demonstrator-0.7.2-ALL.request.json', dir), 'utf8')) as {
  url: string
  headers: Record<string, string>
  body: fhir3.Parameters
}
const realResponse = JSON.parse(readFileSync(new URL('demonstrator-0.7.2-ALL.response.json', dir), 'utf8')) as fhir3.Bundle
const realClaims = decodeUnsignedJwt<GpConnectJwtClaims>(realRequest.headers.Authorization.replace('Bearer ', ''))!

const requester = {
  user: { userId: 'sim-user-ph-pharm', name: 'Priya Desai (Pharmacist)', professionalRegistration: 'SIM-GPhC-0001' },
  organisation: { odsCode: 'SIMPH1', name: 'Northern Online Pharmacy (simulated)' },
}

async function ourRequest(section: 'ALL' | 'SUM' = 'ALL', now = new Date()) {
  const endpoint = (await new MockSds().getGpConnectEndpoint('SIMGP2'))!
  return buildCareRecordRequest({ nhsNumber: '9990000050', section, endpoint, requester, consumer: MIDDLEWARE, traceId: 't', now })
}

/** Keys at every level of a JSON value (arrays collapsed), for shape comparison. */
function shape(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.length ? shape(v[0], `${path}[]`) : [`${path}[]`]
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => [`${path}.${k}`, ...shape(x, `${path}.${k}`)])
  }
  return []
}

describe('the real example', () => {
  it('its JWT passes the producer rules our simulator enforces', () => {
    const at = new Date((realClaims.iat + 10) * 1000)
    expect(checkJwtClaims(realClaims, { version: '0.7', url: realRequest.url, now: at })).toEqual([])
  })

  it('our parser reads its response', () => {
    const section = parseCareRecordResponse(realResponse, 'ALL')
    expect(section).toMatchObject({
      section: 'ALL',
      title: 'Allergies and Adverse Reactions',
      generatedAt: '2026-09-29T13:18:50+01:00',
      practice: { odsCode: 'A20047', name: "Dr Legg's Surgery" },
    })
    expect(section.html).toContain('Allergy to Penicillin, Patient experienced rash, nausea and vomiting')
  })
})

describe('our HTML request matches the real one', () => {
  it('same headers and Parameters body', async () => {
    const ours = await ourRequest()
    expect(Object.keys(ours.headers).sort()).toEqual(Object.keys(realRequest.headers).sort())
    for (const h of ['Ssp-InteractionID', 'Accept', 'Content-Type']) expect(ours.headers[h]).toBe(realRequest.headers[h])
    expect(ours.url.endsWith('/Patient/$gpc.getcarerecord')).toBe(true)
    expect(shape(ours.body)).toEqual(shape(realRequest.body))
    expect(ours.body.parameter?.map(p => p.valueIdentifier?.system ?? p.valueCodeableConcept?.coding?.[0]?.system)).toEqual(
      realRequest.body.parameter?.map(p => p.valueIdentifier?.system ?? p.valueCodeableConcept?.coding?.[0]?.system),
    )
  })

  it('same JWT claims, shapes and identifier systems', async () => {
    const ours = (await ourRequest()).jwtClaims
    expect(Object.keys(ours).sort()).toEqual(Object.keys(realClaims).sort())
    expect(ours.aud).toBe(realClaims.aud)
    for (const k of ['requested_record', 'requesting_organization', 'requesting_device'] as const) {
      expect(shape(ours[k])).toEqual(shape(realClaims[k]))
    }
    // Practitioner: nothing the real one lacks, and the required structure is
    // present (a name prefix is optional: our pharmacist has no title).
    const realPrac = new Set(shape(realClaims.requesting_practitioner))
    const ourPrac = new Set(shape(ours.requesting_practitioner))
    expect([...ourPrac].filter(k => !realPrac.has(k))).toEqual([])
    expect([...realPrac].filter(k => !ourPrac.has(k))).toEqual(['.name.prefix'])
    const systems = (c: GpConnectJwtClaims) => [
      c.requested_record.identifier?.[0]?.system,
      c.requesting_organization.identifier?.[0]?.system,
      c.requesting_practitioner.identifier?.[0]?.system,
    ]
    expect(systems(ours)).toEqual(systems(realClaims))
  })

  it('and our JWT passes the same rules', async () => {
    const now = new Date()
    const ours = await ourRequest('ALL', now)
    expect(checkJwtClaims(ours.jwtClaims, { version: '0.7', url: ours.url, now })).toEqual([])
  })
})

describe('our simulated response matches the real one', () => {
  const headingsAndTables = (html: string) => ({
    h1: [...html.matchAll(/<h1>(.*?)<\/h1>/g)].map(m => m[1]),
    h2: [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map(m => m[1]),
    tables: [...html.matchAll(/<table id="([^"]+)"><thead><tr>(.*?)<\/tr>/g)].map(m => [m[1], [...m[2].matchAll(/<th>(.*?)<\/th>/g)].map(x => x[1])]),
    dateColumn: html.includes('class="date-column"'),
  })

  it('Allergies section: same headings, table ids, columns and date-column cells', async () => {
    const real = parseCareRecordResponse(realResponse, 'ALL').html
    // Margaret Evans has a current allergy; Historical is empty in our data, so compare the current table fully
    const ex = await ourRequest('ALL', new Date())
    const ours = parseCareRecordResponse(await simulatedGpSystems()(ex), 'ALL').html
    const r = headingsAndTables(real)
    const o = headingsAndTables(ours)
    expect(o.h1).toEqual(r.h1)
    expect(o.h2).toEqual(r.h2)
    expect(o.tables[0]).toEqual(r.tables[0])
    expect(o.dateColumn).toBe(true)
    expect(ours).toMatch(/^<div xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"><h1>/)
    expect(ours).toContain('Allergy to Penicillin, ')
  })

  it('bundle: same Composition shape and the same supporting resources with fullUrls', async () => {
    const ex = await ourRequest('ALL', new Date())
    const ours = await simulatedGpSystems()(ex)
    const comp = (b: fhir3.Bundle) => b.entry!.find(e => (e.resource as fhir3.FhirResource).resourceType === 'Composition')!.resource!
    const compKeys = (b: fhir3.Bundle) => Object.keys(comp(b)).sort()
    expect(compKeys(ours)).toEqual(compKeys(realResponse))
    const supporting = (b: fhir3.Bundle) =>
      b.entry!.filter(e => e.fullUrl).map(e => (e.resource as fhir3.FhirResource).resourceType).sort()
    expect(supporting(ours)).toEqual(supporting(realResponse))
    expect(ours.type).toBe(realResponse.type)
    expect(PATIENTS.some(p => p.nhsNumber === '9990000050')).toBe(true)
  })
})

describe('second real Allergies example: no current, one historical', () => {
  const real2 = JSON.parse(readFileSync(new URL('demonstrator-0.7.2-ALL-2.section.json', dir), 'utf8')).text.div as string

  async function ourAllergies(nhsNumber: string) {
    const patient = PATIENTS.find(p => p.nhsNumber === nhsNumber)!
    const endpoint = (await new MockSds().getGpConnectEndpoint(patient.gpOdsCode))!
    const ex = buildCareRecordRequest({ nhsNumber, section: 'ALL', endpoint, requester, consumer: MIDDLEWARE, traceId: 't', now: new Date() })
    return parseCareRecordResponse(await simulatedGpSystems()(ex), 'ALL').html
  }

  it('our empty "current" block is character-for-character the real one', async () => {
    const block = /<div><h2>Current Allergies and Adverse Reactions<\/h2><p>.*?<\/p><\/div>/.exec(real2)![0]
    expect(await ourAllergies('9990000115')).toContain(block)
  })

  it('our historical table has the same structure, with date-column on both date cells', async () => {
    const ours = await ourAllergies('9990000115')
    const skeleton = (html: string) =>
      /<div><h2>Historical[^<]*<\/h2>.*?<\/table><\/div>/.exec(html)![0].replace(/(<td[^>]*>)[^<]*(<\/td>)/g, '$1$2')
    expect(skeleton(ours)).toBe(skeleton(real2))
  })

  it('the whole section has the same overall skeleton as the real one', async () => {
    const strip = (html: string) => html.replace(/(<td[^>]*>)[^<]*(<\/td>)/g, '$1$2')
    expect(strip(await ourAllergies('9990000115'))).toBe(strip(real2))
  })
})
