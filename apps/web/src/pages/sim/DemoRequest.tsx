import { useEffect, useState } from 'react'
import { api } from '../../api'
import Link from '../../Link'
import { Button, Card, ErrorBox, SimNote } from '../../ui'

interface Provider {
  odsCode: string
  name: string
  typeLabel: string
  active: boolean
  users: Array<{ userId: string; name: string; role: string; active: boolean }>
}

interface PatientSummary {
  nhsNumber: string
  name: string
  age: number
  scenario: string
}

interface Created {
  consentId: string
  patientName: string
  provider: string
  patientLink: string
  notification: { sent: true; to: string } | { sent: false; reason: string }
}

// Stand-in for the provider portal (step 5): act as a simulated clinician and
// ask a synthetic patient for consent.
export default function DemoRequest() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [patients, setPatients] = useState<PatientSummary[]>([])
  const [userId, setUserId] = useState('sim-user-ph-pharm')
  const [nhsNumber, setNhsNumber] = useState('9990000018')
  const [result, setResult] = useState<Created | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Provider[]>('/api/sim/providers').then(r => r.ok && setProviders(r.data))
    api<PatientSummary[]>('/api/sim/patients').then(r => r.ok && setPatients(r.data))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setResult(null)
    const res = await api<Created>('/api/sim/consent-requests', { body: { userId, nhsNumber } })
    setBusy(false)
    if (res.ok) setResult(res.data)
    else setError(res.message + (Array.isArray(res.details.reasons) ? ` (${res.details.reasons.join(', ')})` : ''))
  }

  const select = 'mt-1 block w-full rounded border border-gray-400 px-3 py-2'
  return (
    <div className="max-w-2xl space-y-5">
      <h2 className="text-2xl font-semibold">Demo: ask a patient for consent</h2>
      <SimNote>
        Stands in for the provider portal until it is built. Choose who is asking and which synthetic patient. Try the S-flag,
        deceased and under-16 patients to see requests refused, and users who are admins, have left or belong to a suspended
        organisation.
      </SimNote>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="font-semibold">Asking as</span>
          <select className={select} value={userId} onChange={e => setUserId(e.target.value)}>
            {providers.map(o => (
              <optgroup key={o.odsCode} label={`${o.name} (${o.typeLabel}${o.active ? '' : ', suspended'})`}>
                {o.users.map(u => (
                  <option key={u.userId} value={u.userId}>
                    {u.name} · {u.role}
                    {u.active ? '' : ' · inactive'}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-semibold">Patient</span>
          <select className={select} value={nhsNumber} onChange={e => setNhsNumber(e.target.value)}>
            {patients.map(p => (
              <option key={p.nhsNumber} value={p.nhsNumber}>
                {p.name} ({p.age}) · {p.nhsNumber}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={busy}>
          Send consent request
        </Button>
      </form>
      {error && <ErrorBox>{error}</ErrorBox>}
      {result && (
        <Card className="space-y-2">
          <p className="font-semibold">
            Request sent to {result.patientName} from {result.provider}.
          </p>
          <p>
            {result.notification.sent
              ? `A text message with a link was sent to ${result.notification.to}.`
              : `No text message was sent (${result.notification.reason}). The patient would need to be given the link another way.`}
          </p>
          <ul className="ml-5 list-disc">
            {result.notification.sent && (
              <li>
                <a className="text-brand underline" href="/sim/phone" target="_blank" rel="noreferrer">
                  Open the simulated phone
                </a>{' '}
                and follow the link, or
              </li>
            )}
            <li>
              <Link className="text-brand underline" href={result.patientLink}>
                go straight to the patient&rsquo;s page
              </Link>
            </li>
          </ul>
        </Card>
      )}
    </div>
  )
}
