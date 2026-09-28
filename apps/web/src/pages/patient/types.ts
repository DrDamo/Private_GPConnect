export interface Session {
  authenticated: boolean
  assurance?: 'nhs-login-p9' | 'sms-otp'
  name?: string | null
  consentId?: string | null
  expiresAt?: string
}

export interface ConsentView {
  id: string
  status: 'pending' | 'active' | 'declined' | 'withdrawn' | 'expired'
  provider: { name: string; type: string; typeLabel: string }
  purpose: string
  requestedBy: string
  requestedAt: string
  requestExpiresAt: string
  permissions: string[]
  recordParts: string[]
  durationDays: number
  narrowedBySignIn: boolean
  decision: { outcome: 'granted' | 'declined'; at: string; via: 'nhs-login' | 'sms' } | null
  validFrom: string | null
  expiresAt: string | null
  withdrawal: { at: string; by: string } | null
  consentText?: string
  consentTextVersion?: string
  consentTextHash?: string
}

export interface AccessLogEntry {
  at: string
  outcome: 'success' | 'denied' | 'failure'
  description: string
  seq: number
}
