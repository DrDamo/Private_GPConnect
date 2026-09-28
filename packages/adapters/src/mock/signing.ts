import { createHmac, timingSafeEqual } from 'node:crypto'

// Stateless signed tokens for the simulators (NHS login codes, etc.), so they
// work across serverless instances without shared storage. Not a JWT library;
// only the simulators use this.

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url')

export function signToken(payload: Record<string, unknown>, key: string): string {
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', key).update(body).digest('base64url')
  return `${body}.${sig}`
}

/** Returns the payload if the signature is valid and `exp` (epoch ms) is in the future. */
export function verifyToken<T extends { exp: number }>(token: string, key: string, now: Date): T | null {
  const [body, sig, ...rest] = token.split('.')
  if (!body || !sig || rest.length) return null
  const expected = createHmac('sha256', key).update(body).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
    return typeof payload.exp === 'number' && payload.exp > now.getTime() ? payload : null
  } catch {
    return null
  }
}
