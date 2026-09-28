import { describe, expect, it } from 'vitest'
import { PATIENTS } from '@pgpc/fixtures'
import { AdapterError, displayName, MockPds, pdsPatientFromFhir, toPdsFhirPatient } from '../src'

const pds = new MockPds()

async function expectAdapterError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AdapterError && e.code === code)
}

describe('MockPds.getPatient', () => {
  it('returns a full record for an unrestricted patient', async () => {
    const p = await pds.getPatient('9990000018')
    expect(p).toMatchObject({
      nhsNumber: '9990000018',
      confidentiality: 'U',
      restricted: false,
      deceased: false,
      birthDate: '1984-03-12',
      mobile: '07700900001',
      gp: { odsCode: 'SIMGP1', since: '2015-06-01' },
      address: { postalCode: 'LS6 1AA' },
    })
    expect(displayName(p)).toBe('Mrs Sarah Jane THOMPSON')
  })

  it('accepts NHS numbers with spaces', async () => {
    expect((await pds.getPatient('999 000 0018')).nhsNumber).toBe('9990000018')
  })

  it('withholds address, mobile and GP for a restricted (S-flag) patient', async () => {
    const p = await pds.getPatient('9990000069')
    expect(p.restricted).toBe(true)
    expect(p.confidentiality).toBe('R')
    expect(p.address).toBeUndefined()
    expect(p.mobile).toBeUndefined()
    expect(p.gp).toBeUndefined()
  })

  it('reports a deceased patient', async () => {
    expect(await pds.getPatient('9990000077')).toMatchObject({ deceased: true, deceasedDateTime: '2026-08-02T10:15:00+01:00' })
  })

  it('rejects an invalid NHS number', async () => {
    await expectAdapterError(pds.getPatient('9990000019'), 'invalid-request')
  })

  it('reports not found for a valid but unknown NHS number', async () => {
    await expectAdapterError(pds.getPatient('9990000204'), 'not-found')
  })
})

describe('MockPds.search', () => {
  it('finds a unique exact match, case-insensitively', async () => {
    expect((await pds.search({ family: 'sharma', birthDate: '1990-07-25' }))?.nhsNumber).toBe('9990000034')
  })

  it('returns null for no match', async () => {
    expect(await pds.search({ family: 'Sharma', birthDate: '1990-07-26' })).toBeNull()
  })

  it('refuses an ambiguous search, and a postcode resolves it', async () => {
    await expectAdapterError(pds.search({ family: 'Smith', given: 'John', birthDate: '1985-02-14' }), 'too-many-matches')
    const p = await pds.search({ family: 'Smith', birthDate: '1985-02-14', postalCode: 'bs41ab' })
    expect(p?.nhsNumber).toBe('9990000166')
  })

  it('requires family name and an ISO birth date', async () => {
    await expectAdapterError(pds.search({ family: ' ', birthDate: '1990-07-25' }), 'invalid-request')
    await expectAdapterError(pds.search({ family: 'Sharma', birthDate: '25/07/1990' }), 'invalid-request')
  })
})

describe('pdsPatientFromFhir', () => {
  it('round-trips every fixture without losing what PDS would release', () => {
    for (const sim of PATIENTS) {
      const p = pdsPatientFromFhir(toPdsFhirPatient(sim))
      expect(p.nhsNumber).toBe(sim.nhsNumber)
      expect(p.birthDate).toBe(sim.birthDate)
      expect(p.restricted).toBe(sim.confidentiality !== 'U')
      expect(p.deceased).toBe(Boolean(sim.deceasedDateTime))
      if (!p.restricted) {
        expect(p.gp?.odsCode).toBe(sim.gpOdsCode)
        expect(p.mobile).toBe(sim.mobile)
      }
    }
  })

  it('ignores a historic address and prefers the usual name', () => {
    const p = pdsPatientFromFhir({
      resourceType: 'Patient',
      identifier: [{ system: 'https://fhir.nhs.uk/Id/nhs-number', value: '9990000018' }],
      name: [{ use: 'nickname', family: 'X', given: ['Y'] }, { use: 'usual', family: 'Real', given: ['Name'] }],
      address: [
        { use: 'home', line: ['Old'], postalCode: 'OLD 1', period: { end: '2020-01-01' } },
        { use: 'home', line: ['New'], postalCode: 'NEW 1' },
      ],
    })
    expect(p.name?.family).toBe('Real')
    expect(p.address?.postalCode).toBe('NEW 1')
    expect(p.confidentiality).toBe('U')
  })

  it('rejects a Patient without an NHS number', () => {
    expect(() => pdsPatientFromFhir({ resourceType: 'Patient' })).toThrow(AdapterError)
  })
})
