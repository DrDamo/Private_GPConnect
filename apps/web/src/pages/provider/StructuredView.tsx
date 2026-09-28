import { useEffect, useState } from 'react'
import { api } from '../../api'
import { formatDate, formatDateTime } from '../../format'
import { Button, Card, ErrorBox, Notice } from '../../ui'
import { REASON_TEXT } from './types'

// Structured data (GP Connect Access Record: Structured, FHIR STU3), parsed
// with the GP Connect Demonstrator's extractors. Shows what a provider system
// would import; the raw Bundle can be downloaded as-is.

interface Medication {
  id: string
  drugName?: string
  dosageInstruction?: string
  prescriptionType?: string
  status?: string
  isCurrent?: boolean
  startDate?: string
  lastIssuedDate?: string
  prescribedQuantity?: string
}
interface Allergy {
  id: string
  causativeAgent?: string
  snomedCode?: string
  reaction?: string
  status?: string
  dateRecorded?: string
}
interface Problem {
  id: string
  problem?: string
  clinicalStatus?: string
  significance?: string
  startDate?: string
  endDate?: string
}
interface Observation {
  id: string
  date?: string
  description?: string
  value?: string
  unit?: string
}
interface Consultation {
  id: string
  date?: string
  type?: string
  clinician?: string
  topics: Array<{ title?: string; items: Array<{ display?: string; narrativeText?: string }>; categories: Array<{ items: Array<{ display?: string; narrativeText?: string }> }> }>
}
interface StructuredResponse {
  areas: string[]
  practice: { odsCode: string; supplier: string }
  retrievedBy: string
  retrievedAt: string
  warnings: Array<{ list: string; code: string; note: string | null }>
  data: { medications?: Medication[]; allergies?: Allergy[]; problems?: Problem[]; observations?: Observation[]; consultations?: Consultation[] }
  exchange: unknown
}

const NKA = '716186003'

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-gray-600">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-gray-700">
          <tr>
            {head.map(h => (
              <th key={h} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </Card>
  )
}

export default function StructuredView({ consentId }: { consentId: string }) {
  const [data, setData] = useState<StructuredResponse | null>(null)
  const [error, setError] = useState<{ message: string; reasons?: string[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    api<StructuredResponse>(`/api/provider/consents/${consentId}/structured`).then(r => {
      if (cancelled) return
      if (r.ok) setData(r.data)
      else setError({ message: r.message, reasons: Array.isArray(r.details.reasons) ? (r.details.reasons as string[]) : undefined })
    })
    return () => {
      cancelled = true
    }
  }, [consentId])

  async function download() {
    const res = await fetch(`/api/provider/consents/${consentId}/structured?format=bundle`)
    const blob = new Blob([await res.text()], { type: 'application/fhir+json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `gp-record-stu3-${consentId.slice(0, 8)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (error) {
    return (
      <ErrorBox>
        <p>{error.message}</p>
        {error.reasons?.map(r => (
          <p key={r}>{REASON_TEXT[r] ?? r}</p>
        ))}
      </ErrorBox>
    )
  }
  if (!data) return <p className="text-gray-600">Retrieving structured data from the GP system…</p>
  const d = data.data

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">
        FHIR STU3 from the practice&rsquo;s {data.practice.supplier} system · retrieved {formatDateTime(data.retrievedAt)} by {data.retrievedBy}. Only the
        parts of the record the patient agreed to were requested.
      </p>
      {data.warnings.map(w => (
        <Notice key={w.list + w.code}>
          <strong>{w.list}:</strong> {w.note ?? w.code}
        </Notice>
      ))}

      {d.allergies && (
        <Section title="Allergies and adverse reactions">
          <Table
            head={['Allergy', 'Reaction', 'Status', 'Recorded']}
            empty="No allergies recorded (this is not the same as ‘no known allergies’)."
            rows={d.allergies.map(a =>
              a.snomedCode === NKA
                ? [<strong key="n">No known allergies</strong>, '', a.status ?? '', formatDate(a.dateRecorded)]
                : [<strong key="a">{a.causativeAgent}</strong>, a.reaction ?? '', a.status ?? '', formatDate(a.dateRecorded)],
            )}
          />
        </Section>
      )}

      {d.medications && (
        <Section title="Medicines">
          <p className="text-xs text-gray-600">The dosage shown is the prescriber&rsquo;s original instruction text, exactly as recorded.</p>
          <Table
            head={['Medicine', 'Dosage instruction', 'Type', 'Quantity', 'Last issued', 'Current']}
            empty="No medicines recorded."
            rows={d.medications.map(m => [
              <strong key="m">{m.drugName}</strong>,
              m.dosageInstruction ?? '',
              m.prescriptionType ?? '',
              m.prescribedQuantity ?? '',
              formatDate(m.lastIssuedDate),
              m.isCurrent ? 'Yes' : 'No',
            ])}
          />
        </Section>
      )}

      {d.problems && (
        <Section title="Problems and conditions">
          <Table
            head={['Problem', 'Status', 'Significance', 'Started', 'Ended']}
            empty="No problems recorded."
            rows={d.problems.map(p => [<strong key="p">{p.problem}</strong>, p.clinicalStatus ?? '', p.significance ?? '', formatDate(p.startDate), formatDate(p.endDate)])}
          />
        </Section>
      )}

      {d.observations && (
        <Section title="Measurements">
          <Table
            head={['Date', 'Measurement', 'Value']}
            empty="No measurements recorded."
            rows={d.observations.map(o => [formatDate(o.date), o.description ?? '', `${o.value ?? ''} ${o.unit ?? ''}`.trim()])}
          />
        </Section>
      )}

      {d.consultations && (
        <Section title="Consultations (most recent 3)">
          <Table
            head={['Date', 'Type', 'Clinician', 'Notes']}
            empty="No consultations recorded."
            rows={d.consultations.map(c => [
              formatDate(c.date),
              c.type ?? '',
              c.clinician ?? '',
              c.topics
                .flatMap(t => [...t.items, ...t.categories.flatMap(cat => cat.items)])
                .map(i => i.narrativeText ?? i.display)
                .filter(Boolean)
                .join(' · '),
            ])}
          />
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={download}>
          Download FHIR bundle (STU3)
        </Button>
        <span className="text-xs text-gray-600">What a provider system would import. Downloading is logged as a retrieval.</span>
      </div>
      <details className="rounded border border-gray-300 bg-white p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Technical: what was sent to the GP system</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(data.exchange, null, 2)}</pre>
      </details>
    </div>
  )
}
