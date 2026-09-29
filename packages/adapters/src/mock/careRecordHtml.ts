import type { HtmlSection } from '@pgpc/core'
import type { SimClinicalRecord, SimPatient } from '@pgpc/fixtures'

// PLACEHOLDER HTML in the style of GP Connect Access Record HTML sections
// (headings + tables with the same ids, class="date-column" on date cells,
// "No 'X' data is recorded" messages, exclusion banners). The Allergies (ALL)
// section's structure is checked against a real example in
// fixtures/gpconnect-examples/html; other sections await real examples.

export const SECTION_TITLES: Record<HtmlSection, string> = {
  SUM: 'Summary',
  ENC: 'Encounters',
  CLI: 'Clinical Items',
  PRB: 'Problems and Issues',
  ALL: 'Allergies and Adverse Reactions',
  MED: 'Medications',
  REF: 'Referrals',
  OBS: 'Observations',
  IMM: 'Immunisations',
  ADM: 'Administrative Items',
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const gpcDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`
}

function table(id: string, heading: string, columns: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return `<div><h2>${esc(heading)}</h2><p>No '${esc(heading)}' data is recorded for this patient.</p></div>`
  }
  const head = columns.map(c => `<th>${esc(c)}</th>`).join('')
  // As in real output, date columns are marked class="date-column".
  const cell = (c: string, i: number) => (/Date$|^Date$/.test(columns[i]) ? `<td class="date-column">${esc(c)}</td>` : `<td>${esc(c)}</td>`)
  const body = rows.map(r => `<tr>${r.map(cell).join('')}</tr>`).join('')
  return `<div><h2>${esc(heading)}</h2><table id="${id}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

const EXCLUSION_BANNER =
  '<div class="exclusion-banner"><p>Items excluded due to confidentiality and/or patient preferences.</p></div>'

export function renderSection(section: HtmlSection, patient: SimPatient, rec: SimClinicalRecord): string {
  const visibleProblems = rec.problems.filter(p => !p.confidential)
  const visibleEncounters = rec.encounters.filter(e => !e.confidential)
  const hasExclusions = rec.problems.some(p => p.confidential) || rec.encounters.some(e => e.confidential)
  const banner = hasExclusions && ['SUM', 'PRB', 'ENC'].includes(section) ? EXCLUSION_BANNER : ''

  const activeProblems = table(
    'prb-tab-actprob',
    'Active Problems and Issues',
    ['Start Date', 'Entry', 'Significance', 'Details'],
    visibleProblems.filter(p => p.status === 'active').map(p => [gpcDate(p.onset), p.term, p.significance === 'major' ? 'Major' : 'Minor', '']),
  )
  const inactiveProblems = table(
    'prb-tab-majinact',
    'Major Inactive Problems and Issues',
    ['Start Date', 'End Date', 'Entry', 'Details'],
    visibleProblems
      .filter(p => p.status === 'past' && p.significance === 'major')
      .map(p => [gpcDate(p.onset), p.ended ? gpcDate(p.ended) : '', p.term, '']),
  )
  const otherInactive = table(
    'prb-tab-othinact',
    'Other Inactive Problems and Issues',
    ['Start Date', 'End Date', 'Entry', 'Details'],
    visibleProblems
      .filter(p => p.status === 'past' && p.significance === 'minor')
      .map(p => [gpcDate(p.onset), p.ended ? gpcDate(p.ended) : '', p.term, '']),
  )
  const allergies = table(
    'all-tab-curr',
    'Current Allergies and Adverse Reactions',
    ['Start Date', 'Details'],
    rec.allergies === 'no-known-allergies'
      ? [['', 'No known allergies']]
      : rec.allergies.map(a => [gpcDate(a.recorded), `Allergy to ${a.substance}, ${a.reaction}`]),
  )
  const acute = table(
    'med-tab-acu-med',
    'Acute Medication (Last 12 Months)',
    ['Type', 'Start Date', 'Medication Item', 'Dosage Instruction', 'Quantity', 'Scheduled End Date', 'Days Duration', 'Additional Information'],
    rec.medications.filter(m => m.type === 'Acute').map(m => ['Acute', gpcDate(m.started), m.name, m.dosage, m.quantity, '', '', '']),
  )
  const repeat = table(
    'med-tab-curr-rep',
    'Current Repeat Medication',
    ['Type', 'Start Date', 'Medication Item', 'Dosage Instruction', 'Quantity', 'Last Issued Date', 'Number of Prescriptions Issued', 'Max Issues', 'Review Date', 'Additional Information'],
    rec.medications.filter(m => m.type === 'Repeat').map(m => ['Repeat', gpcDate(m.started), m.name, m.dosage, m.quantity, gpcDate(m.lastIssued), '', '', '', '']),
  )
  const encounters = (rows = visibleEncounters) =>
    table('enc-tab', 'Encounters', ['Date', 'Title', 'Details'], rows.map(e => [gpcDate(e.date), `${e.type} — ${e.clinician}`, e.summary]))
  const observations = table('obs-tab', 'Observations', ['Date', 'Entry', 'Value', 'Details'], rec.observations.map(o => [gpcDate(o.date), o.name, o.value, '']))

  const bodies: Record<HtmlSection, string> = {
    SUM: [activeProblems, allergies, acute, repeat, encounters(visibleEncounters.slice(0, 3))].join(''),
    PRB: [activeProblems, inactiveProblems, otherInactive].join(''),
    ALL: [allergies, table('all-tab-hist', 'Historical Allergies and Adverse Reactions', ['Start Date', 'End Date', 'Details'], [])].join(''),
    MED: [acute, repeat, table('med-tab-past-med', 'Past Medications', ['Type', 'Start Date', 'Medication Item', 'Dosage Instruction'], [])].join(''),
    ENC: encounters(),
    CLI: table('cli-tab', 'Clinical Items', ['Date', 'Entry', 'Details'], rec.observations.map(o => [gpcDate(o.date), o.name, o.value])),
    OBS: observations,
    IMM: table('imm-tab', 'Immunisations', ['Date', 'Vaccination', 'Part', 'Contents', 'Details'], rec.immunisations.map(i => [gpcDate(i.date), i.vaccine, '', '', ''])),
    REF: table('ref-tab', 'Referrals', ['Date', 'From', 'To', 'Priority', 'Details'], rec.referrals.map(r => [gpcDate(r.date), 'GP practice', r.to, 'Routine', r.reason])),
    ADM: table('adm-tab', 'Administrative Items', ['Date', 'Entry', 'Details'], [[gpcDate(patient.gpRegisteredSince), 'Registration', 'Registered at this practice']]),
  }

  return `<div xmlns="http://www.w3.org/1999/xhtml"><h1>${SECTION_TITLES[section]}</h1>${banner}${bodies[section]}</div>`
}
