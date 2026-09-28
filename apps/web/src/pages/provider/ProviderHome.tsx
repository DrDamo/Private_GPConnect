import { useEffect, useState } from 'react'
import { api } from '../../api'
import { formatDate } from '../../format'
import Link from '../../Link'
import { navigate } from '../../router'
import { Button, Card, ErrorBox, StatusTag } from '../../ui'
import ProviderFrame from './ProviderFrame'
import type { ConsentSummary, PatientLookup, ProviderSession } from './types'

function Search() {
  const [mode, setMode] = useState<'nhs' | 'demographics'>('nhs')
  const [nhs, setNhs] = useState('')
  const [demo, setDemo] = useState({ family: '', given: '', birthDate: '', postalCode: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (mode === 'nhs') {
      const n = nhs.replace(/\s/g, '')
      if (!/^\d{10}$/.test(n)) return setError('Enter a 10-digit NHS number')
      return navigate(`/provider/patient/${n}`)
    }
    setBusy(true)
    const q = new URLSearchParams(Object.entries(demo).filter(([, v]) => v.trim()) as [string, string][])
    const res = await api<PatientLookup>(`/api/provider/patients?${q}`)
    setBusy(false)
    if (res.ok) navigate(`/provider/patient/${res.data.patient.nhsNumber}`)
    else setError(res.message)
  }

  const input = 'mt-1 block w-full rounded border border-gray-400 px-3 py-2'
  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold">Find a patient</h2>
      <div className="flex gap-4 text-sm" role="tablist">
        {(['nhs', 'demographics'] as const).map(m => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'font-semibold text-brand underline' : 'text-gray-600'} onClick={() => setMode(m)}>
            {m === 'nhs' ? 'By NHS number' : 'By name and date of birth'}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-3">
        {mode === 'nhs' ? (
          <label className="block max-w-xs">
            <span className="text-sm font-semibold">NHS number</span>
            <input className={`${input} font-mono`} inputMode="numeric" value={nhs} onChange={e => setNhs(e.target.value)} placeholder="999 000 0018" />
          </label>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              Family name
              <input className={input} value={demo.family} onChange={e => setDemo({ ...demo, family: e.target.value })} required />
            </label>
            <label className="block text-sm font-semibold">
              Given name (optional)
              <input className={input} value={demo.given} onChange={e => setDemo({ ...demo, given: e.target.value })} />
            </label>
            <label className="block text-sm font-semibold">
              Date of birth
              <input className={input} type="date" value={demo.birthDate} onChange={e => setDemo({ ...demo, birthDate: e.target.value })} required />
            </label>
            <label className="block text-sm font-semibold">
              Postcode (optional)
              <input className={input} value={demo.postalCode} onChange={e => setDemo({ ...demo, postalCode: e.target.value })} />
            </label>
          </div>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
        <Button type="submit" disabled={busy}>
          Search the NHS Spine (PDS)
        </Button>
      </form>
    </Card>
  )
}

function ConsentTable({ session }: { session: ProviderSession }) {
  const [consents, setConsents] = useState<ConsentSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (session.user.role !== 'clinician') return
    api<ConsentSummary[]>('/api/provider/consents').then(r => (r.ok ? setConsents(r.data) : setError(r.message)))
  }, [session])

  if (session.user.role !== 'clinician') return <p className="text-gray-700">Provider admins manage staff accounts and cannot see patient information.</p>
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (!consents) return <p className="text-gray-600">Loading…</p>
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Consent requests and consents</h2>
      {consents.length === 0 ? (
        <p className="text-gray-600">None yet. Find a patient to ask for consent.</p>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="px-4 py-2">Patient</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Requested</th>
                <th className="px-4 py-2">Access until</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {consents.map(c => (
                <tr key={c.id}>
                  <td className="px-4 py-2">
                    <Link className="text-brand underline" href={`/provider/patient/${c.nhsNumber}`}>
                      {c.patientName ?? c.nhsNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <StatusTag audience="provider" status={c.status} />
                  </td>
                  <td className="px-4 py-2">{formatDate(c.requestedAt)}</td>
                  <td className="px-4 py-2">{c.status === 'active' ? formatDate(c.expiresAt) : ''}</td>
                  <td className="px-4 py-2">
                    {c.status === 'active' && c.scope.actions.includes('html.view') && (
                      <Link className="font-semibold text-brand underline" href={`/provider/record/${c.id}`}>
                        View record
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  )
}

export default function ProviderHome() {
  return (
    <ProviderFrame>
      {session => (
        <>
          {session.user.role === 'clinician' && <Search />}
          <ConsentTable session={session} />
        </>
      )}
    </ProviderFrame>
  )
}
