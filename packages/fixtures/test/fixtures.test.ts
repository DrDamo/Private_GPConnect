import { describe, expect, it } from 'vitest'
import { isValidNhsNumber } from '@pgpc/core'
import { PATIENTS, PRACTICES, PROVIDER_ORGS, PROVIDER_USERS, practiceByOds, providerOrgByOds } from '../src'

describe('synthetic fixtures are safe and consistent', () => {
  it.each(PATIENTS.map(p => [p.nhsNumber, p] as const))('%s has a valid, test-range NHS number', (nhs) => {
    expect(isValidNhsNumber(nhs)).toBe(true)
    expect(nhs.startsWith('999')).toBe(true)
  })

  it('NHS numbers and NHS login subs are unique', () => {
    expect(new Set(PATIENTS.map(p => p.nhsNumber)).size).toBe(PATIENTS.length)
    const subs = PATIENTS.flatMap(p => (p.nhsLogin ? [p.nhsLogin.sub] : []))
    expect(new Set(subs).size).toBe(subs.length)
  })

  it('mobiles are only in the Ofcom drama range', () => {
    for (const p of PATIENTS) if (p.mobile) expect(p.mobile).toMatch(/^07700900\d{3}$/)
  })

  it('every patient is registered at a known practice', () => {
    for (const p of PATIENTS) expect(practiceByOds(p.gpOdsCode)).toBeDefined()
  })

  it('restricted patients carry no address or mobile', () => {
    for (const p of PATIENTS.filter(p => p.confidentiality === 'R')) {
      expect(p.address).toBeUndefined()
      expect(p.mobile).toBeUndefined()
    }
  })

  it('all organisation codes are simulated', () => {
    for (const code of [...PRACTICES.map(p => p.odsCode), ...PROVIDER_ORGS.map(o => o.odsCode)]) {
      expect(code).toMatch(/^SIM/)
    }
  })

  it('every provider user belongs to a known organisation', () => {
    for (const u of PROVIDER_USERS) expect(providerOrgByOds(u.organisationOdsCode)).toBeDefined()
  })
})
