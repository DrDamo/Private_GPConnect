// Errors every adapter implementation (mock or real) reports in the same way,
// so callers handle a real PDS timeout exactly like a simulated one.

export type AdapterName = 'pds' | 'sds' | 'nhs-login' | 'sms' | 'gp-connect' | 'mesh'

export type AdapterErrorCode =
  | 'not-found'
  | 'invalid-request'
  | 'too-many-matches'
  | 'unauthorised'
  | 'timeout'
  | 'unavailable'
  | 'not-supported'

export class AdapterError extends Error {
  readonly adapter: AdapterName
  readonly code: AdapterErrorCode
  /** Transient failures are worth retrying; the others are not. */
  readonly retryable: boolean
  /** What the remote system said, e.g. { httpStatus: 404, gpConnectCode: 'PATIENT_NOT_FOUND', diagnostics: '…' }. */
  readonly details?: Record<string, string | number>

  constructor(adapter: AdapterName, code: AdapterErrorCode, message: string, details?: Record<string, string | number>) {
    super(`${adapter}: ${message}`)
    this.name = 'AdapterError'
    this.adapter = adapter
    this.code = code
    this.retryable = code === 'timeout' || code === 'unavailable'
    this.details = details
  }
}
