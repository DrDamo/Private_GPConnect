import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { formatDate } from '../../format'
import Link from '../../Link'
import { Button, Card, ErrorBox, Notice, StatusTag } from '../../ui'
import ProviderFrame from './ProviderFrame'
import { REASON_TEXT, type ConsentSummary, type PatientLookup, type ProviderSession } from './types'

const formatNhs = (n: string) => `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`

function RequestForm({ nhsNumber, onDone }: { nhsNumber: string; onDone: (message: string) => void }) {
  const [purpose, setPurpose] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await api<{ notification: { sent: boolean; to?: string; reason?: string } }>('/api/provider/consent-requests', {
      body: { nhsNumber, purpose },
    })
    setBusy(false)
    if (!res.ok) return setError(res.message)
    const n = res.data.notification
    onDone(
      n.sent
        ? `Request sent. The patient has been texted at the mobile number their GP practice holds (${n.to}).`
        : 'Request created, but the patient has no mobile number on record. Give them the link another way.',
    )
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="font-semibold">Why do you need to see their record?</span>
        <span className="block text-sm text-gray-600">The patient sees exactly this. Be specific and plain.</span>
        <input className="mt-1 block w-full rounded border border-gray-400 px-3 py-2" value={purpose} onChange={e => setPurpose(e.target.value)} minLength={5} maxLength={200} required placeholder="e.g. Checking it is safe to supply weight-loss medication" />
      </label>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button type="submit" disabled={busy}>
        Ask the patient for consent
      </Button>
    </form>
  )
}

function Content({ nhsNumber }: { session: ProviderSession; nhsNumber: string }) {
  const [data, setData] = useState<PatientLookup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await api<PatientLookup>(`/api/provider/patients/${nhsNumber}`)
    if (res.ok) setData(res.data)
    else setError(res.message)
  }, [nhsNumber])

  useEffect(() => {
    let cancelled = false
    api<PatientLookup>(`/api/provider/patients/${nhsNumber}`).then(res => {
      if (cancelled) return
      if (res.ok) setData(res.data)
      else setError(res.message)
    })
    return () => {
      cancelled = true
    }
  }, [nhsNumber])

  async function cancel(c: ConsentSummary) {
    const res = await api(`/api/provider/consents/${c.id}/cancel`, { body: { reason: c.status === 'active' ? 'Episode complete' : 'Request cancelled' } })
    if (res.ok) load()
    else setError(res.message)
  }

  if (error) return <ErrorBox>{error}</ErrorBox>
  if (!data) return <p className="text-gray-600">Looking up the patient on PDS…</p>
  const { patient, gpConnect, consents } = data
  const active = consents.find(c => c.status === 'active')
  const pending = consents.find(c => c.status === 'pending')

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">{patient.restricted ? 'Restricted record' : patient.name}</h2>
          <span className="font-mono text-gray-700">{formatNhs(patient.nhsNumber)}</span>
        </div>
        {!patient.restricted && (
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-gray-600">Date of birth</dt>
            <dd>
              {formatDate(patient.birthDate)} ({patient.age})
            </dd>
            <dt className="text-gray-600">Gender</dt>
            <dd className="capitalize">{patient.gender}</dd>
            <dt className="text-gray-600">GP practice</dt>
            <dd>
              {patient.gp?.name ?? 'Not known'}
              {gpConnect === 'not-enabled' && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Not on GP Connect</span>}
            </dd>
          </dl>
        )}
      </Card>

      {!patient.eligible ? (
        <ErrorBox>
          {patient.ineligibleReasons.map(r => (
            <p key={r}>{REASON_TEXT[r] ?? r}</p>
          ))}
        </ErrorBox>
      ) : (
        <>
          {message && <Notice>{message}</Notice>}
          {gpConnect === 'not-enabled' && (
            <Notice>This patient&rsquo;s GP practice does not offer GP Connect. You can ask for consent, but the record cannot be retrieved.</Notice>
          )}
          {active ? (
            <Card className="space-y-2">
              <p>
                <StatusTag audience="provider" status="active" /> The patient agreed on {formatDate(active.decision?.at)} ({active.decision?.via === 'sms' ? 'text message code: view only' : 'NHS login'}). Access until{' '}
                {formatDate(active.expiresAt)}.
              </p>
              <p className="text-sm text-gray-700">Parts of the record: {active.htmlSections.map(s => s.label).join(', ')}</p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link className="rounded bg-brand px-4 py-2 font-semibold text-white" href={`/provider/record/${active.id}`}>
                  View GP record
                </Link>
                <Button variant="secondary" onClick={() => cancel(active)}>
                  End access (episode complete)
                </Button>
              </div>
            </Card>
          ) : pending ? (
            <Card className="space-y-2">
              <p>
                <StatusTag audience="provider" status="pending" /> Waiting for the patient. Requested {formatDate(pending.requestedAt)}; lapses {formatDate(pending.requestExpiresAt)}.
              </p>
              <Button variant="secondary" onClick={() => cancel(pending)}>
                Cancel request
              </Button>
            </Card>
          ) : (
            <Card>
              <RequestForm
                nhsNumber={patient.nhsNumber}
                onDone={m => {
                  setMessage(m)
                  load()
                }}
              />
            </Card>
          )}
        </>
      )}

      {consents.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">History with this patient</h3>
          <ul className="space-y-1 text-sm">
            {consents.map(c => (
              <li key={c.id}>
                <StatusTag audience="provider" status={c.status} /> {formatDate(c.requestedAt)} · {c.purpose}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default function PatientPage({ nhsNumber }: { nhsNumber: string }) {
  return <ProviderFrame>{session => <Content session={session} nhsNumber={nhsNumber} />}</ProviderFrame>
}
