import { PATIENTS, type SimPatient } from '@pgpc/fixtures'
import { AdapterError } from '../errors'
import type { IdentityProofingLevel, NhsLoginAdapter, NhsLoginIdentity } from '../nhsLogin'
import { signToken, verifyToken } from './signing'

// Simulated NHS login. Instead of a real login, the patient picks a persona on
// a simulator page, which asks the API to issue a signed authorisation code.
// exchangeCode checks it exactly as the real flow must: signature, expiry,
// redirect URI and nonce.

export interface NhsLoginPersona {
  sub: string
  displayName: string
  nhsNumber: string
  identityProofingLevel: IdentityProofingLevel
}

export function nhsLoginPersonas(patients: SimPatient[] = PATIENTS): NhsLoginPersona[] {
  return patients.flatMap(p =>
    p.nhsLogin
      ? [
          {
            sub: p.nhsLogin.sub,
            displayName: `${p.name.given[0]} ${p.name.family}`,
            nhsNumber: p.nhsNumber,
            identityProofingLevel: p.nhsLogin.identityProofingLevel,
          },
        ]
      : [],
  )
}

type CodePayload = { sub: string; nonce: string; redirectUri: string; exp: number }

const CODE_TTL_MS = 5 * 60 * 1000

export interface MockNhsLoginOptions {
  signingKey: string
  /** Where the simulator's persona picker lives in the web app. */
  simulatorPath?: string
  clock?: () => Date
  patients?: SimPatient[]
}

export class MockNhsLogin implements NhsLoginAdapter {
  private readonly key: string
  private readonly simulatorPath: string
  private readonly clock: () => Date
  private readonly patients: SimPatient[]

  constructor(options: MockNhsLoginOptions) {
    if (!options.signingKey) throw new Error('MockNhsLogin requires a signingKey')
    this.key = options.signingKey
    this.simulatorPath = options.simulatorPath ?? '/sim/nhs-login'
    this.clock = options.clock ?? (() => new Date())
    this.patients = options.patients ?? PATIENTS
  }

  authorizationUrl(params: { state: string; nonce: string; redirectUri: string }): string {
    const q = new URLSearchParams({
      response_type: 'code',
      scope: 'openid profile nhs_number',
      vtr: '["P9.Cp.Cd"]',
      state: params.state,
      nonce: params.nonce,
      redirect_uri: params.redirectUri,
    })
    return `${this.simulatorPath}?${q}`
  }

  /** Simulator only: the persona picker calls this to "log in" as `sub`. */
  issueCode(params: { sub: string; nonce: string; redirectUri: string; state: string }): string {
    if (!this.patients.some(p => p.nhsLogin?.sub === params.sub)) {
      throw new AdapterError('nhs-login', 'not-found', 'Unknown persona')
    }
    const code = signToken(
      { sub: params.sub, nonce: params.nonce, redirectUri: params.redirectUri, exp: this.clock().getTime() + CODE_TTL_MS },
      this.key,
    )
    const url = new URL(params.redirectUri, 'http://sim.invalid')
    url.searchParams.set('code', code)
    url.searchParams.set('state', params.state)
    return url.origin === 'http://sim.invalid' ? `${url.pathname}${url.search}` : url.toString()
  }

  async exchangeCode(params: { code: string; redirectUri: string; nonce: string }): Promise<NhsLoginIdentity> {
    const payload = verifyToken<CodePayload>(params.code, this.key, this.clock())
    if (!payload) throw new AdapterError('nhs-login', 'unauthorised', 'Invalid or expired authorisation code')
    if (payload.redirectUri !== params.redirectUri) {
      throw new AdapterError('nhs-login', 'unauthorised', 'redirect_uri mismatch')
    }
    if (payload.nonce !== params.nonce) throw new AdapterError('nhs-login', 'unauthorised', 'nonce mismatch')

    const p = this.patients.find(x => x.nhsLogin?.sub === payload.sub)
    if (!p?.nhsLogin) throw new AdapterError('nhs-login', 'unauthorised', 'Unknown subject')
    const verified = p.nhsLogin.identityProofingLevel === 'P9'
    return {
      sub: p.nhsLogin.sub,
      identityProofingLevel: p.nhsLogin.identityProofingLevel,
      nonce: payload.nonce,
      // As in real NHS login, the NHS number and demographics are only
      // released for identity-verified (P9) accounts.
      ...(verified
        ? { nhsNumber: p.nhsNumber, givenName: p.name.given[0], familyName: p.name.family, birthDate: p.birthDate }
        : {}),
    }
  }
}
