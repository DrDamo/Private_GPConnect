// NHS login (OpenID Connect). The adapter hides the protocol: the caller gets a
// URL to send the patient to, and later swaps the returned code for verified
// identity claims.
// Ref: https://nhsconnect.github.io/nhslogin/

export type IdentityProofingLevel = 'P0' | 'P5' | 'P9'

export interface NhsLoginIdentity {
  sub: string
  nhsNumber?: string
  identityProofingLevel: IdentityProofingLevel
  givenName?: string
  familyName?: string
  birthDate?: string
  nonce: string
}

export interface NhsLoginAdapter {
  authorizationUrl(params: { state: string; nonce: string; redirectUri: string }): string
  /** Throws AdapterError('unauthorised') for an invalid, expired or mismatched code. */
  exchangeCode(params: { code: string; redirectUri: string; nonce: string }): Promise<NhsLoginIdentity>
}
