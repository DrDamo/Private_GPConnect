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
      return reply
        .code(ADAPTER_STATUS[err.code])
        .send({ error: `${err.adapter}-${err.code}`, message: err.message, retryable: err.retryable })
    }
    const e = err as { validation?: unknown; statusCode?: number; message?: string }
    if (e.validation) return reply.code(400).send({ error: 'invalid-request', message: e.message })
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: 'invalid-request', message: e.message })
    req.log.error(err)
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong' })
  })
}
