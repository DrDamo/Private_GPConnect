import { describe, expect, it } from 'vitest'
import {
  ageOn,
  createConsentRequest,
  decide,
  declineConsent,
  DENY_REASONS,
  grantConsent,
  withdrawConsent,
  type AccessRequest,
  type ConsentRecord,
  type DenyReason,
} from '../src'
import { days, NHS_NUMBER, NOW, OTHER_NHS_NUMBER, p9Decision, PROVIDER, requestInput, smsDecision } from './helpers'

const activeConsent = (): ConsentRecord => grantConsent(createConsentRequest(requestInput(), NOW), p9Decision(), NOW)

function baseRequest(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    action: 'html.view',
    actor: { userId: 'u-clin-1', role: 'clinician', active: true, organisationOdsCode: PROVIDER.odsCode },
    organisation: { odsCode: PROVIDER.odsCode, type: PROVIDER.type, active: true },
    patient: { nhsNumber: NHS_NUMBER, restricted: false, deceased: false, birthDate: '1980-05-17' },
    consent: activeConsent(),
    htmlSection: 'MED',
    now: days(1),
    ...overrides,
  }
}

describe('decide: permits', () => {
  it('html.view of a consented section', () => {
    expect(decide(baseRequest())).toEqual({ decision: 'permit', reasons: [] })
  })

  it('structured.retrieve of consented areas', () => {
    const req = baseRequest({ action: 'structured.retrieve', htmlSection: undefined, clinicalAreas: ['medications', 'allergies'] })
    expect(decide(req).decision).toBe('permit')
  })

  it('document.send', () => {
    expect(decide(baseRequest({ action: 'document.send', htmlSection: undefined })).decision).toBe('permit')
  })

  it('a patient who turns 16 today', () => {
    expect(decide(baseRequest({ patient: { ...baseRequest().patient, birthDate: '2010-10-02' } })).decision).toBe('permit')
  })
})

// Each case changes exactly one thing from the permitted baseline and must be
// denied for exactly the expected reason(s).
const denyCases: Array<[string, Partial<AccessRequest> | (() => Partial<AccessRequest>), DenyReason[]]> = [
  ['inactive user', { actor: { ...baseRequest().actor, active: false } }, ['actor-inactive']],
  ['provider admin', { actor: { ...baseRequest().actor, role: 'provider-admin' } }, ['actor-role-not-permitted']],
  ['user from another organisation', { actor: { ...baseRequest().actor, organisationOdsCode: 'OTHER' } }, ['actor-not-in-organisation']],
  ['suspended organisation', { organisation: { ...baseRequest().organisation, active: false } }, ['organisation-inactive']],
  ['restricted (S-flag) patient', { patient: { ...baseRequest().patient, restricted: true } }, ['patient-restricted']],
  ['deceased patient', { patient: { ...baseRequest().patient, deceased: true } }, ['patient-deceased']],
  ['patient aged 15', { patient: { ...baseRequest().patient, birthDate: '2010-10-03' } }, ['patient-under-16']],
  ['patient with no birth date', { patient: { ...baseRequest().patient, birthDate: undefined } }, ['patient-age-unknown']],
  ['no consent', { consent: null }, ['no-consent']],
  ['consent for another patient', { patient: { ...baseRequest().patient, nhsNumber: OTHER_NHS_NUMBER } }, ['consent-patient-mismatch']],
  [
    'consent held by another organisation',
    () => ({ consent: { ...activeConsent(), provider: { ...PROVIDER, odsCode: 'OTHER' } } }),
    ['consent-organisation-mismatch'],
  ],
  ['pending consent', () => ({ consent: createConsentRequest(requestInput(), NOW) }), ['consent-not-active']],
  ['declined consent', () => ({ consent: declineConsent(createConsentRequest(requestInput(), NOW), p9Decision(), NOW) }), ['consent-not-active']],
  ['withdrawn consent', () => ({ consent: withdrawConsent(activeConsent(), 'patient', NOW) }), ['consent-not-active']],
  ['expired consent', { now: days(90) }, ['consent-not-active']],
  [
    'structured.retrieve under SMS (view-only) consent',
    () => ({
      action: 'structured.retrieve',
      htmlSection: undefined,
      clinicalAreas: ['medications'],
      consent: grantConsent(createConsentRequest(requestInput(), NOW), smsDecision(), NOW),
    }),
    ['action-not-consented'],
  ],
  ['html.view without a section', { htmlSection: undefined }, ['html-section-required']],
  ['html.view of an unconsented section', { htmlSection: 'ENC' }, ['html-section-not-consented']],
  ['structured.retrieve without areas', { action: 'structured.retrieve', htmlSection: undefined, clinicalAreas: [] }, ['clinical-areas-required']],
  [
    'structured.retrieve including an unconsented area',
    { action: 'structured.retrieve', htmlSection: undefined, clinicalAreas: ['medications', 'problems'] },
    ['clinical-area-not-consented'],
  ],
]

describe('decide: denies', () => {
  it.each(denyCases)('%s', (_, overrides, expected) => {
    const req = baseRequest(typeof overrides === 'function' ? overrides() : overrides)
    expect(decide(req)).toEqual({ decision: 'deny', reasons: expected })
  })

  it('every deny reason is exercised by at least one case', () => {
    const covered = new Set(denyCases.flatMap(([, , reasons]) => reasons))
    expect(DENY_REASONS.filter(r => !covered.has(r))).toEqual([])
  })

  it('reports every applicable reason, not just the first', () => {
    const req = baseRequest({
      actor: { ...baseRequest().actor, active: false },
      patient: { ...baseRequest().patient, restricted: true },
      consent: null,
    })
    expect(decide(req)).toEqual({ decision: 'deny', reasons: ['actor-inactive', 'patient-restricted', 'no-consent'] })
  })
})

describe('ageOn', () => {
  it.each([
    ['2010-10-01', '2026-10-01T00:00:00Z', 16],
    ['2010-10-02', '2026-10-01T23:59:59Z', 15],
    ['2008-02-29', '2026-02-28T12:00:00Z', 17],
    ['2008-02-29', '2026-03-01T12:00:00Z', 18],
  ])('born %s, on %s, is aged %i', (birth, on, expected) => {
    expect(ageOn(birth, new Date(on))).toBe(expected)
  })
})
