import { createHash } from 'node:crypto'
import type { ConsentRecord } from './consent'
import { ACTION_LABELS, CLINICAL_AREA_LABELS, HTML_SECTION_LABELS } from './labels'
import { ASSURANCE_RULES } from './profiles'
import type { AssuranceLevel } from './types'

// The exact words a patient agrees to. Rendered deterministically from the
// consent record so the server can re-create and hash what was shown; the
// version and hash are stored as evidence with the decision.

export const CONSENT_TEXT_VERSION = '2026-09-v1'

const unique = (items: string[]) => [...new Set(items)]

/**
 * What the patient will actually be agreeing to, given how they signed in:
 * a text-message sign-in can only authorise viewing, for a shorter period.
 */
export function effectiveOffer(record: ConsentRecord, assurance: AssuranceLevel) {
  const rule = ASSURANCE_RULES[assurance]
  const actions = record.scope.actions.filter(a => rule.allowedActions.includes(a))
  return {
    actions,
    htmlSections: actions.includes('html.view') ? record.scope.htmlSections : [],
    clinicalAreas: actions.includes('structured.retrieve') ? record.scope.clinicalAreas : [],
    durationDays: Math.min(record.requestedDurationDays, rule.maxDurationDays),
    narrowed: actions.length < record.scope.actions.length || rule.maxDurationDays < record.requestedDurationDays,
  }
}

export function renderConsentText(record: ConsentRecord, assurance: AssuranceLevel): string {
  const offer = effectiveOffer(record, assurance)
  const parts = unique([
    ...offer.htmlSections.map(s => HTML_SECTION_LABELS[s]),
    ...offer.clinicalAreas.map(a => CLINICAL_AREA_LABELS[a]),
  ])
  return [
    `${record.provider.name} has asked to see your GP record.`,
    `Reason: ${record.episode.purpose}.`,
    `Requested by: ${record.requestedBy.name}.`,
    `If you agree, they can:`,
    ...offer.actions.map(a => `- ${ACTION_LABELS[a]}`),
    `The parts of your record they can see: ${parts.join(', ')}.`,
    `This lasts for ${offer.durationDays} days unless you withdraw it sooner. You can withdraw at any time.`,
    `Withdrawing stops any further access. It does not remove information they have already seen or copied into their own records.`,
    `Every time they look at your record it is logged, and you can see the log.`,
  ].join('\n')
}

export const consentTextHash = (text: string) => createHash('sha256').update(text).digest('hex')
