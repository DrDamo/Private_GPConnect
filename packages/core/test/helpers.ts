import type { ConsentEvidence, ConsentRequestInput, PatientDecisionInput } from '../src'

export const NOW = new Date('2026-10-01T09:00:00Z')
export const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000)

export const NHS_NUMBER = '9692136701'
export const OTHER_NHS_NUMBER = '9000000009'
export const PROVIDER = { odsCode: 'PHX01', name: 'Example Online Pharmacy', type: 'pharmacy' as const }

export function requestInput(overrides: Partial<ConsentRequestInput> = {}): ConsentRequestInput {
  return {
    id: 'consent-1',
    nhsNumber: NHS_NUMBER,
    provider: PROVIDER,
    episode: { id: 'ep-1', purpose: 'Assessment for supply of medication' },
    requestedBy: { userId: 'u-clin-1', name: 'Dr A Clinician', role: 'clinician' },
    ...overrides,
  }
}

export const evidence = (channel: ConsentEvidence['channel'] = 'nhs-login'): ConsentEvidence => ({
  channel,
  subject: channel === 'nhs-login' ? 'nhslogin-sub-123' : '07*** ***123',
  consentTextVersion: 'v1',
  consentTextHash: 'a'.repeat(64),
})

export const p9Decision = (overrides: Partial<PatientDecisionInput> = {}): PatientDecisionInput => ({
  assurance: 'nhs-login-p9',
  evidence: evidence('nhs-login'),
  verifiedNhsNumber: NHS_NUMBER,
  ...overrides,
})

export const smsDecision = (overrides: Partial<PatientDecisionInput> = {}): PatientDecisionInput => ({
  assurance: 'sms-otp',
  evidence: evidence('sms'),
  verifiedNhsNumber: NHS_NUMBER,
  ...overrides,
})
