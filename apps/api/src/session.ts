import type { FastifyReply, FastifyRequest } from 'fastify'
import { signToken, verifyToken } from '@pgpc/adapters'
import type { AssuranceLevel } from '@pgpc/core'

// Patient sessions and NHS login sign-in state, carried in signed, httpOnly,
// SameSite=Strict cookies scoped to /api/patient. Stateless, so they work
// across serverless instances.

export const SESSION_COOKIE = 'pgpc_patient'
export const OIDC_COOKIE = 'pgpc_oidc'
const COOKIE_PATH = '/api/patient'

export const SESSION_TTL_MS = 30 * 60 * 1000
const OIDC_TTL_MS = 10 * 60 * 1000

export interface PatientSession {
  nhsNumber: string
  assurance: AssuranceLevel
  /** NHS login `sub`, or the masked mobile for a text-message sign-in. */
  subject: string
  /** A text-message sign-in is limited to the one consent it was sent for. */
  consentId?: string
  exp: number
}

export interface OidcState {
  state: string
  nonce: string
  returnTo: string
  exp: number
}

function cookieOptions(req: FastifyRequest, maxAgeMs: number) {
  return {
    path: COOKIE_PATH,
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: req.protocol === 'https',
    maxAge: Math.floor(maxAgeMs / 1000),
  }
}

export function readSession(req: FastifyRequest, key: string): PatientSession | null {
  const token = req.cookies[SESSION_COOKIE]
  return token ? verifyToken<PatientSession>(token, key, new Date()) : null
}

export function writeSession(req: FastifyRequest, reply: FastifyReply, key: string, session: Omit<PatientSession, 'exp'>) {
  const token = signToken({ ...session, exp: Date.now() + SESSION_TTL_MS }, key)
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(req, SESSION_TTL_MS))
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: COOKIE_PATH })
}

export function writeOidcState(req: FastifyRequest, reply: FastifyReply, key: string, s: Omit<OidcState, 'exp'>) {
  reply.setCookie(OIDC_COOKIE, signToken({ ...s, exp: Date.now() + OIDC_TTL_MS }, key), cookieOptions(req, OIDC_TTL_MS))
}

export function takeOidcState(req: FastifyRequest, reply: FastifyReply, key: string): OidcState | null {
  const token = req.cookies[OIDC_COOKIE]
  reply.clearCookie(OIDC_COOKIE, { path: COOKIE_PATH })
  return token ? verifyToken<OidcState>(token, key, new Date()) : null
}

/** "07700900001" → "07*** ***001" */
export const maskMobile = (m: string) => `${m.slice(0, 2)}*** ***${m.slice(-3)}`

/** Same-origin relative paths only. */
export const isSafeReturnPath = (p: string) => /^\/(?!\/)[A-Za-z0-9/_\-.]*$/.test(p) && p.length <= 200
