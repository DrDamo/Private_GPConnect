import { describe, expect, it } from 'vitest'
import { consentTextHash, createConsentRequest, effectiveOffer, renderConsentText } from '../src'
import { NOW, requestInput } from './helpers'

const record = () => createConsentRequest(requestInput(), NOW)

describe('renderConsentText', () => {
  it('names the provider, purpose, requester, permissions, record parts and duration', () => {
    const text = renderConsentText(record(), 'nhs-login-p9')
    expect(text).toContain('Example Online Pharmacy has asked to see your GP record.')
    expect(text).toContain('Reason: Assessment for supply of medication.')
    expect(text).toContain('Requested by: Dr A Clinician.')
    expect(text).toContain('- Copy parts of your GP record into their own records')
    expect(text).toContain('Summary, Medicines, Allergies')
    expect(text).toContain('This lasts for 90 days')
    expect(text).toContain('does not remove information they have already seen')
  })

  it('reflects the narrower offer for a text-message sign-in', () => {
    const text = renderConsentText(record(), 'sms-otp')
    expect(text).toContain('- Look at parts of your GP record')
    expect(text).not.toContain('Copy parts')
    expect(text).not.toContain('Send your GP practice')
    expect(text).toContain('This lasts for 30 days')
    expect(effectiveOffer(record(), 'sms-otp').narrowed).toBe(true)
    expect(effectiveOffer(record(), 'nhs-login-p9').narrowed).toBe(false)
  })

  it('is deterministic, so its hash can be re-derived as evidence', () => {
    expect(consentTextHash(renderConsentText(record(), 'nhs-login-p9'))).toBe(
      consentTextHash(renderConsentText(record(), 'nhs-login-p9')),
    )
    expect(consentTextHash('a')).toMatch(/^[0-9a-f]{64}$/)
  })
})
