import { describe, expect, it } from 'vitest'
import {
  AuditLog,
  ConsentError,
  ConsentService,
  InMemoryAuditStore,
  InMemoryConsentRepository,
  NotFoundError,
} from '../src'
import { consentRepositoryContract } from '../testing/contracts'
import { NHS_NUMBER, NOW, OTHER_NHS_NUMBER, p9Decision, PROVIDER, requestInput } from './helpers'

consentRepositoryContract('in-memory', async () => new InMemoryConsentRepository())

function setup() {
  const auditStore = new InMemoryAuditStore()
  const audit = new AuditLog(auditStore, { pseudonymKey: 'k', clock: () => NOW })
  const service = new ConsentService({
    repository: new InMemoryConsentRepository(),
    audit,
    clock: () => NOW,
    newId: () => 'c-1',
  })
  const { id: _id, ...input } = requestInput()
  return { service, audit, auditStore, input, ctx: { correlationId: 'corr-1' } }
}

describe('ConsentService', () => {
  it('audits the full request → grant → withdraw lifecycle as one valid chain', async () => {
    const { service, audit, input, ctx } = setup()
    await service.request(input, ctx)
    await service.grant('c-1', p9Decision(), ctx)
    await service.withdraw(
      'c-1',
      { kind: 'patient', actor: { type: 'patient', id: 'nhslogin-sub-123' } },
      'changed my mind',
      ctx,
    )

    const events = await audit.forPatient(NHS_NUMBER)
    expect(events.map(e => [e.type, e.outcome])).toEqual([
      ['consent.requested', 'success'],
      ['consent.granted', 'success'],
      ['consent.withdrawn', 'success'],
    ])
    expect(events[1].details).toMatchObject({ status: 'active', assurance: 'nhs-login-p9', channel: 'nhs-login' })
    expect(events.every(e => e.consentId === 'c-1' && e.correlationId === 'corr-1')).toBe(true)
    expect((await audit.verify()).valid).toBe(true)
    expect((await service.get('c-1'))?.status).toBe('withdrawn')
  })

  it('audits a failed transition and leaves the record unchanged', async () => {
    const { service, audit, input, ctx } = setup()
    await service.request(input, ctx)
    await expect(service.grant('c-1', p9Decision({ verifiedNhsNumber: OTHER_NHS_NUMBER }), ctx)).rejects.toBeInstanceOf(
      ConsentError,
    )
    expect((await service.get('c-1'))?.status).toBe('pending')
    const last = (await audit.forPatient(NHS_NUMBER)).at(-1)
    expect(last).toMatchObject({ type: 'consent.granted', outcome: 'failure', details: { error: 'identity-mismatch' } })
  })

  it('audits a rejected request', async () => {
    const { service, audit, input, ctx } = setup()
    await expect(service.request({ ...input, durationDays: 999 }, ctx)).rejects.toBeInstanceOf(ConsentError)
    const [event] = await audit.forPatient(NHS_NUMBER)
    expect(event).toMatchObject({
      type: 'consent.requested',
      outcome: 'failure',
      actor: { type: 'user', organisationOdsCode: PROVIDER.odsCode },
      details: { error: 'invalid-duration' },
    })
  })

  it('throws NotFoundError for an unknown consent', async () => {
    const { service, ctx } = setup()
    await expect(service.grant('nope', p9Decision(), ctx)).rejects.toBeInstanceOf(NotFoundError)
  })
})
