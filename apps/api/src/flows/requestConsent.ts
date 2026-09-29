import { displayName } from '@pgpc/adapters'
import { patientIneligibility, type ConsentRecord, type ConsentScope, type ProviderType, type UserRole } from '@pgpc/core'
import { auditedSend } from '../auditedSend'
import { HttpError } from '../errors'
import { maskMobile } from '../session'
import type { Services } from '../services'

// A provider asks a patient for consent. Shared by the simulator's demo
// launcher (step 4) and the provider API (step 5):
//   1. PDS: the patient must exist and be eligible (not S-flag/deceased/under-16)
//   2. create the pending consent (audited by ConsentService)
//   3. text the patient at the mobile number held on PDS, never one the
//      provider supplies (PLAN.md §2.4)

export interface RequestConsentInput {
  user: { userId: string; name: string; role: UserRole; organisationOdsCode: string; active: boolean }
  organisation: { odsCode: string; name: string; type: ProviderType; active: boolean }
  nhsNumber: string
  purpose: string
  episodeId: string
  scope?: ConsentScope
  durationDays?: number
  /** Origin for the link in the text message, e.g. https://example.org */
  origin: string
  correlationId: string
}

export interface RequestConsentResult {
  consent: ConsentRecord
  patientName: string
  notification: { sent: true; to: string } | { sent: false; reason: 'no-mobile' | 'sms-failed' }
}

export async function requestConsent(services: Services, input: RequestConsentInput): Promise<RequestConsentResult> {
  const { audit, adapters, consents } = services
  const actor = {
    type: 'user' as const,
    id: input.user.userId,
    organisationOdsCode: input.organisation.odsCode,
    role: input.user.role,
  }

  if (!input.user.active || !input.organisation.active || input.user.organisationOdsCode !== input.organisation.odsCode) {
    throw new HttpError(403, 'not-permitted', 'This user or organisation cannot request consent')
  }
  if (input.user.role !== 'clinician') {
    throw new HttpError(403, 'not-permitted', 'Only clinicians can request consent')
  }

  const patient = await adapters.pds.getPatient(input.nhsNumber)
  const ineligible = patientIneligibility(patient, new Date())
  if (ineligible.length) {
    await audit.record({
      type: 'consent.requested',
      outcome: 'denied',
      actor,
      nhsNumber: patient.nhsNumber,
      correlationId: input.correlationId,
      details: { reasons: ineligible },
    })
    throw new HttpError(422, 'patient-ineligible', 'This patient cannot be included in the service', { reasons: ineligible })
  }

  const consent = await consents.request(
    {
      nhsNumber: patient.nhsNumber,
      provider: { odsCode: input.organisation.odsCode, name: input.organisation.name, type: input.organisation.type },
      episode: { id: input.episodeId, purpose: input.purpose },
      requestedBy: { userId: input.user.userId, name: input.user.name, role: input.user.role },
      scope: input.scope,
      durationDays: input.durationDays,
    },
    { correlationId: input.correlationId },
  )

  const notificationEvent = {
    type: 'consent.notification',
    actor: { type: 'system' as const, id: 'consent-notifier' },
    nhsNumber: patient.nhsNumber,
    consentId: consent.id,
    correlationId: input.correlationId,
  }
  let notification: RequestConsentResult['notification']
  if (!patient.mobile) {
    notification = { sent: false, reason: 'no-mobile' }
  } else {
    // Deliberately doesn't name the provider: a text can be read by others, and
    // "medical cannabis clinic" on a lock screen is itself sensitive.
    const body =
      `SIMULATION. A healthcare provider has asked to see your GP record. ` +
      `Review the request: ${input.origin}/patient/consent/${consent.id} ` +
      `If you were not expecting this, you can ignore this message.`
    const mobile = patient.mobile
    let smsFailed = false
    try {
      await auditedSend(
        audit,
        { ...notificationEvent, details: { channel: 'sms' } },
        () =>
          adapters.sms.send({ to: mobile, body, reference: consent.id }).catch(err => {
            smsFailed = true
            throw err
          }),
        () => ({}),
        () => ({ reason: 'sms-failed' }),
      )
      notification = { sent: true, to: maskMobile(mobile) }
    } catch (err) {
      // A failed text is reported to the provider; a failed audit write is not swallowed.
      if (!smsFailed) throw err
      notification = { sent: false, reason: 'sms-failed' }
    }
  }
  if (!notification.sent && notification.reason === 'no-mobile') {
    await audit.record({ ...notificationEvent, outcome: 'failure', details: { reason: 'no-mobile' } })
  }

  return { consent, patientName: displayName(patient), notification }
}
