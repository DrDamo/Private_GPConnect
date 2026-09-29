import { randomUUID } from 'node:crypto'
import type { AuditEvent, AuditLog } from '@pgpc/core'

// Sending over MESH or SMS is an external side effect: it can't share a
// database transaction with its audit event. So the attempt is audited first
// (if that fails, nothing is sent) and the outcome after. An attempt with no
// outcome means "may have been sent", and the provider and patient are told so.

type AuditInput = Parameters<AuditLog['record']>[0]
type Details = NonNullable<AuditInput['details']>

export const ATTEMPT_SUFFIX = '.attempt'

export const isAttempt = (e: Pick<AuditEvent, 'type'>) => e.type.endsWith(ATTEMPT_SUFFIX)

export async function auditedSend<T>(
  audit: AuditLog,
  event: Omit<AuditInput, 'outcome' | 'details'> & { details?: Details },
  send: () => Promise<T>,
  outcome: (result: T) => Details,
  failure: (err: unknown) => Details,
): Promise<T> {
  const attemptId = randomUUID()
  await audit.record({ ...event, type: event.type + ATTEMPT_SUFFIX, outcome: 'success', details: { ...event.details, attemptId } })
  let result: T
  try {
    result = await send()
  } catch (err) {
    await audit.record({ ...event, outcome: 'failure', details: { ...event.details, ...failure(err), attemptId } })
    throw err
  }
  await audit.record({ ...event, outcome: 'success', details: { ...event.details, ...outcome(result), attemptId } })
  return result
}

/** Attempts with no recorded outcome: the send may or may not have happened. */
export function unresolvedAttempts(events: AuditEvent[]): AuditEvent[] {
  const resolved = new Set(events.filter(e => !isAttempt(e)).map(e => e.details?.attemptId).filter(Boolean))
  return events.filter(e => isAttempt(e) && !resolved.has(e.details?.attemptId))
}
