import { describe, expect, it } from 'vitest'
import {
  ConsentError,
  createConsentRequest,
  declineConsent,
  effectiveStatus,
  grantConsent,
  PROVIDER_PROFILES,
  withdrawConsent,
  type ConsentErrorCode,
} from '../src'
import { days, NOW, OTHER_NHS_NUMBER, p9Decision, requestInput, smsDecision } from './helpers'

function expectConsentError(fn: () => unknown, code: ConsentErrorCode) {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(ConsentError)
    expect((err as ConsentError).code).toBe(code)
    return
  }
  throw new Error(`expected ConsentError ${code}`)
}

describe('createConsentRequest', () => {
  it('defaults to the full provider-type profile and 90 days', () => {
    const r = createConsentRequest(requestInput(), NOW)
    expect(r.status).toBe('pending')
    expect(r.version).toBe(1)
    expect(r.scope).toEqual(PROVIDER_PROFILES.pharmacy.scope)
    expect(r.requestedDurationDays).toBe(90)
    expect(r.requestExpiresAt).toBe(days(7).toISOString())
  })

  it('copies the scope rather than aliasing the shared profile', () => {
    const r = createConsentRequest(requestInput(), NOW)
    r.scope.actions.push('html.view')
    expect(PROVIDER_PROFILES.pharmacy.scope.actions).toHaveLength(3)
  })

  it('accepts a narrower scope', () => {
    const scope = { actions: ['html.view' as const], htmlSections: ['MED' as const], clinicalAreas: [] }
    expect(createConsentRequest(requestInput({ scope }), NOW).scope).toEqual(scope)
  })

  it.each([
    ['an HTML section outside the profile', { actions: ['html.view'], htmlSections: ['ENC'], clinicalAreas: [] }],
    ['a clinical area outside the profile', { actions: ['structured.retrieve'], htmlSections: [], clinicalAreas: ['consultations'] }],
    ['no actions', { actions: [], htmlSections: ['MED'], clinicalAreas: [] }],
    ['html.view without sections', { actions: ['html.view'], htmlSections: [], clinicalAreas: [] }],
    ['structured.retrieve without areas', { actions: ['structured.retrieve'], htmlSections: [], clinicalAreas: [] }],
  ])('rejects %s', (_, scope) => {
    expectConsentError(() => createConsentRequest(requestInput({ scope: scope as never }), NOW), 'invalid-scope')
  })

  it.each(['9692136702', '123', '96921367O1'])('rejects invalid NHS number %s', nhsNumber => {
    expectConsentError(() => createConsentRequest(requestInput({ nhsNumber }), NOW), 'invalid-nhs-number')
  })

  it.each([0, 181, 1.5])('rejects a duration of %s days', durationDays => {
    expectConsentError(() => createConsentRequest(requestInput({ durationDays }), NOW), 'invalid-duration')
  })
})

describe('grantConsent', () => {
  const pending = () => createConsentRequest(requestInput(), NOW)

  it('with NHS login P9 activates the full requested scope for the requested duration', () => {
    const r = grantConsent(pending(), p9Decision(), days(1))
    expect(r.status).toBe('active')
    expect(r.version).toBe(2)
    expect(r.scope).toEqual(PROVIDER_PROFILES.pharmacy.scope)
    expect(r.validFrom).toBe(days(1).toISOString())
    expect(r.expiresAt).toBe(days(91).toISOString())
    expect(r.decision).toMatchObject({ outcome: 'granted', assurance: 'nhs-login-p9' })
  })

  it('with SMS narrows to viewing and notifying the GP (no structured copy) and caps the duration at 30 days', () => {
    const r = grantConsent(pending(), smsDecision(), NOW)
    expect(r.scope).toEqual({ actions: ['html.view', 'document.send'], htmlSections: ['SUM', 'MED', 'ALL'], clinicalAreas: [] })
    expect(r.expiresAt).toBe(days(30).toISOString())
  })

  it('with SMS fails when nothing requested is view-only', () => {
    const scope = { actions: ['structured.retrieve' as const], htmlSections: [], clinicalAreas: ['medications' as const] }
    const r = createConsentRequest(requestInput({ scope }), NOW)
    expectConsentError(() => grantConsent(r, smsDecision(), NOW), 'assurance-insufficient')
  })

  it('rejects a different authenticated patient', () => {
    expectConsentError(
      () => grantConsent(pending(), p9Decision({ verifiedNhsNumber: OTHER_NHS_NUMBER }), NOW),
      'identity-mismatch',
    )
  })

  it('rejects a lapsed request', () => {
    expectConsentError(() => grantConsent(pending(), p9Decision(), days(7)), 'request-expired')
  })

  it('cannot grant twice', () => {
    const active = grantConsent(pending(), p9Decision(), NOW)
    expectConsentError(() => grantConsent(active, p9Decision(), NOW), 'invalid-transition')
  })
})

describe('declineConsent', () => {
  it('records the decline', () => {
    const r = declineConsent(createConsentRequest(requestInput(), NOW), p9Decision(), NOW)
    expect(r.status).toBe('declined')
    expect(r.decision?.outcome).toBe('declined')
    expect(r.expiresAt).toBeUndefined()
  })

  it('checks identity', () => {
    const r = createConsentRequest(requestInput(), NOW)
    expectConsentError(() => declineConsent(r, p9Decision({ verifiedNhsNumber: OTHER_NHS_NUMBER }), NOW), 'identity-mismatch')
  })
})

describe('withdrawConsent', () => {
  const pending = () => createConsentRequest(requestInput(), NOW)
  const active = () => grantConsent(pending(), p9Decision(), NOW)

  it.each(['patient', 'provider', 'admin'] as const)('%s can end an active consent', by => {
    const r = withdrawConsent(active(), by, days(2), 'episode complete')
    expect(r.status).toBe('withdrawn')
    expect(r.withdrawal).toEqual({ at: days(2).toISOString(), by, reason: 'episode complete' })
  })

  it.each(['provider', 'admin'] as const)('%s can cancel a pending request', by => {
    expect(withdrawConsent(pending(), by, NOW).status).toBe('withdrawn')
  })

  it('a patient declines a pending request rather than withdrawing it', () => {
    expectConsentError(() => withdrawConsent(pending(), 'patient', NOW), 'invalid-transition')
  })

  it('cannot withdraw an expired consent', () => {
    expectConsentError(() => withdrawConsent(active(), 'patient', days(91)), 'invalid-transition')
  })
})

describe('effectiveStatus', () => {
  it('expires pending requests after 7 days', () => {
    const r = createConsentRequest(requestInput(), NOW)
    expect(effectiveStatus(r, days(6.9))).toBe('pending')
    expect(effectiveStatus(r, days(7))).toBe('expired')
  })

  it('expires active consents at expiresAt', () => {
    const r = grantConsent(createConsentRequest(requestInput(), NOW), p9Decision(), NOW)
    expect(effectiveStatus(r, days(89.9))).toBe('active')
    expect(effectiveStatus(r, days(90))).toBe('expired')
  })

  it('leaves terminal states alone', () => {
    const r = withdrawConsent(grantConsent(createConsentRequest(requestInput(), NOW), p9Decision(), NOW), 'patient', NOW)
    expect(effectiveStatus(r, days(365))).toBe('withdrawn')
  })
})
