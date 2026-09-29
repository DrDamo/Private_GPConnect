import type { FastifyInstance } from 'fastify'
import { AdapterError } from '@pgpc/adapters'
import { ConcurrentModificationError, ConsentError, NotFoundError } from '@pgpc/core'

/** Errors a route deliberately returns to the caller, with a stable code. */
export class HttpError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details?: Record<string, unknown>
  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

const ADAPTER_STATUS: Record<AdapterError['code'], number> = {
  'not-found': 404,
  'invalid-request': 400,
  'too-many-matches': 422,
  unauthorised: 401,
  timeout: 504,
  unavailable: 503,
  'not-supported': 422,
}

/**
 * Messages for errors people will see. GP Connect's PATIENT_NOT_FOUND is also
 * returned when the patient has dissented to sharing at their practice, and the
 * two are deliberately indistinguishable: never suggest which one it is, and
 * never let "nothing returned" read as "nothing recorded".
 */
const ADAPTER_MESSAGES: Record<string, string> = {
  'gp-connect-not-found':
    "The GP practice's system did not return a record for this patient. This can happen when the practice does not hold " +
    'their record, or when the patient has asked their practice not to share it. No information was returned: do not assume ' +
    'the patient has no allergies, medicines or conditions.',
  'gp-connect-timeout': 'The GP practice’s system did not respond in time. Try again shortly.',
  'gp-connect-unavailable': 'The GP practice’s system is not available at the moment. Try again later.',
}

/** Maps domain errors to consistent JSON responses: { error, message, ...details }. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, ...err.details })
    }
    if (err instanceof ConsentError) return reply.code(409).send({ error: err.code, message: err.message })
    if (err instanceof NotFoundError) return reply.code(404).send({ error: 'not-found', message: err.message })
    if (err instanceof ConcurrentModificationError) {
      return reply.code(409).send({ error: 'conflict', message: 'Someone else changed this at the same time. Please try again.' })
    }
    if (err instanceof AdapterError) {
      const key = `${err.adapter}-${err.code}`
      return reply.code(ADAPTER_STATUS[err.code]).send({
        error: key,
        message: ADAPTER_MESSAGES[key] ?? err.message,
        retryable: err.retryable,
        ...(err.details?.gpConnectCode ? { gpConnectCode: err.details.gpConnectCode } : {}),
      })
    }
    const e = err as { validation?: unknown; statusCode?: number; message?: string }
    if (e.validation) return reply.code(400).send({ error: 'invalid-request', message: e.message })
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: 'invalid-request', message: e.message })
    req.log.error(err)
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong' })
  })
}
