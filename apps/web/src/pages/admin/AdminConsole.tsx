import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { formatDate, formatDateTime } from '../../format'
import { Button, Card, ErrorBox, Notice, SimNote, StatusTag } from '../../ui'

interface AdminUser {
  userId: string
  name: string
  role: 'auditor' | 'operator'
}

type Tab = 'overview' | 'audit' | 'consents' | 'faults'

export default function AdminConsole() {
  const [user, setUser] = useState<AdminUser | null | undefined>(undefined)
  const [tab, setTab] = useState<Tab>('overview')

  const refresh = useCallback(async () => {
    const r = await api<AdminUser>('/api/admin/session')
    setUser(r.ok ? r.data : null)
  }, [])

  useEffect(() => {
    let cancelled = false
    api<AdminUser>('/api/admin/session').then(r => !cancelled && setUser(r.ok ? r.data : null))
    return () => {
      cancelled = true
    }
  }, [])

  if (user === undefined) return <p className="text-gray-600">Loading…</p>
  if (user === null) return <SignIn onDone={refresh} />

  const tabs: Array<[Tab, string]> = [
    ['overview', 'Overview'],
    ['audit', 'Audit trail'],
    ['consents', 'Consent register'],
    ['faults', 'Fault injection'],
  ]
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-200 bg-white px-4 py-3 text-sm">
        <span>
          <span className="font-semibold">{user.name}</span>
          {user.role === 'auditor' && <span className="text-gray-600"> · read only</span>}
        </span>
        <button
          className="text-brand underline"
          onClick={async () => {
            await api('/api/admin/logout', { body: {} })
            refresh()
          }}
        >
          Sign out
        </button>
      </div>
      <div className="flex flex-wrap gap-4 border-b border-gray-300" role="tablist">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-1 pb-2 font-semibold ${tab === t ? 'border-brand text-brand' : 'border-transparent text-gray-600'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'audit' && <AuditTrail />}
      {tab === 'consents' && <ConsentRegister />}
      {tab === 'faults' && <Faults canChange={user.role === 'operator'} />}
    </div>
  )
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  useEffect(() => {
    api<AdminUser[]>('/api/admin/sim/users').then(r => r.ok && setUsers(r.data))
  }, [])
  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-2xl font-semibold">Service administration</h2>
      <SimNote>Simulated sign-in for the people who run the service. Auditors can only read; operators can also inject faults.</SimNote>
      <ul className="grid gap-2">
        {users.map(u => (
          <li key={u.userId}>
            <button
              className="w-full text-left"
              onClick={async () => {
                const r = await api('/api/admin/sim-login', { body: { userId: u.userId } })
                if (r.ok) onDone()
              }}
            >
              <Card className="hover:border-brand">
                <span className="font-semibold">{u.name}</span> <span className="text-sm text-gray-600">· {u.role}</span>
              </Card>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface Overview {
  store: string
  consents: Record<string, number>
  audit: { lastSeq: number; recentWindow: number; recentDenied: number; recentFailures: number; recentRecordAccess: number }
  faults: Record<string, { kind: string; ms?: number }>
}

function Stat({ label, value, tone = '' }: { label: string; value: number | string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-sm text-gray-600">{label}</div>
    </Card>
  )
}

function Overview() {
  const [data, setData] = useState<Overview | null>(null)
  const [verify, setVerify] = useState<{ valid: boolean; checked: number; seq?: number; problem?: string; durationMs: number } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api<Overview>('/api/admin/overview').then(r => r.ok && setData(r.data))
  }, [])
  if (!data) return <p className="text-gray-600">Loading…</p>
  const faultCount = Object.keys(data.faults).length
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 font-semibold">Consents</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Waiting for patient" value={data.consents.pending} />
          <Stat label="Active" value={data.consents.active} tone="text-green-700" />
          <Stat label="Declined" value={data.consents.declined} />
          <Stat label="Withdrawn" value={data.consents.withdrawn} />
          <Stat label="Expired" value={data.consents.expired} />
        </div>
      </section>
      <section>
        <h3 className="mb-2 font-semibold">Last {data.audit.recentWindow} audit events</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Record accesses" value={data.audit.recentRecordAccess} />
          <Stat label="Refused by policy" value={data.audit.recentDenied} tone={data.audit.recentDenied ? 'text-amber-700' : ''} />
          <Stat label="Failures" value={data.audit.recentFailures} tone={data.audit.recentFailures ? 'text-red-700' : ''} />
          <Stat label="Events in total" value={data.audit.lastSeq} />
        </div>
      </section>
      <Card className="space-y-3">
        <h3 className="font-semibold">Audit trail integrity</h3>
        <p className="text-sm text-gray-700">
          Every event is chained to the one before by a SHA-256 hash, so any edit, deletion or reordering is detectable. Verification walks the whole
          chain.
        </p>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const r = await api<NonNullable<typeof verify>>('/api/admin/audit/verify')
            setBusy(false)
            if (r.ok) setVerify(r.data)
          }}
        >
          Verify the chain now
        </Button>
        {verify &&
          (verify.valid ? (
            <p className="font-semibold text-green-700">
              ✓ Intact: {verify.checked} events verified in {verify.durationMs} ms.
            </p>
          ) : (
            <p className="font-semibold text-red-700">
              ✗ Broken at event {verify.seq} ({verify.problem}). {verify.checked} events verified before it.
            </p>
          ))}
      </Card>
      <p className="text-sm text-gray-600">
        Storage: {data.store}. {faultCount ? `${faultCount} simulated fault(s) active.` : 'No simulated faults active.'}
      </p>
    </div>
  )
}

interface AuditRow {
  seq: number
  recordedAt: string
  type: string
  outcome: 'success' | 'denied' | 'failure'
  actor: string
  patientRef: string | null
  consentId: string | null
  details: Record<string, unknown> | null
  hash: string
}

const OUTCOME_TONE = { success: 'text-green-700', denied: 'text-amber-700', failure: 'text-red-700' }

function AuditTrail() {
  const [filters, setFilters] = useState({ type: '', outcome: '', nhsNumber: '' })
  const [rows, setRows] = useState<AuditRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)

  const load = useCallback(
    async (beforeSeq?: number) => {
      const q = new URLSearchParams({ limit: '50' })
      if (filters.type) q.set('type', filters.type)
      if (filters.outcome) q.set('outcome', filters.outcome)
      if (filters.nhsNumber) q.set('nhsNumber', filters.nhsNumber.replace(/\s/g, ''))
      if (beforeSeq) q.set('beforeSeq', String(beforeSeq))
      const r = await api<AuditRow[]>(`/api/admin/audit?${q}`)
      if (!r.ok) return setError(r.message)
      setError(null)
      setRows(prev => (beforeSeq ? [...prev, ...r.data] : r.data))
      setMore(r.data.length === 50)
    },
    [filters],
  )

  useEffect(() => {
    let cancelled = false
    api<AuditRow[]>('/api/admin/audit?limit=50').then(r => {
      if (cancelled || !r.ok) return
      setRows(r.data)
      setMore(r.data.length === 50)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const input = 'mt-1 block w-full rounded border border-gray-400 px-2 py-1.5 text-sm'
  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 sm:grid-cols-4"
        onSubmit={e => {
          e.preventDefault()
          load()
        }}
      >
        <label className="text-sm">
          Event type
          <select className={input} value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })}>
            <option value="">All</option>
            <option value="access.">Record access (all)</option>
            <option value="access.html.view">View record (HTML)</option>
            <option value="access.structured.retrieve">Structured retrieval</option>
            <option value="access.document.send">Send Document</option>
            <option value="consent.">Consent</option>
            <option value="pds.">PDS lookups</option>
            <option value="patient.">Patient sign-in</option>
            <option value="provider.">Provider sign-in</option>
            <option value="admin.">Admin</option>
          </select>
        </label>
        <label className="text-sm">
          Outcome
          <select className={input} value={filters.outcome} onChange={e => setFilters({ ...filters, outcome: e.target.value })}>
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="denied">Refused by policy</option>
            <option value="failure">Failure</option>
          </select>
        </label>
        <label className="text-sm">
          Patient NHS number
          <input className={input} inputMode="numeric" value={filters.nhsNumber} onChange={e => setFilters({ ...filters, nhsNumber: e.target.value })} placeholder="searched by pseudonym" />
        </label>
        <div className="flex items-end">
          <Button type="submit">Search</Button>
        </div>
      </form>
      <Notice>The log never stores NHS numbers: patients appear as a keyed pseudonym. Searching by NHS number is itself logged, and the patient can see it.</Notice>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              {['#', 'When', 'Event', 'Outcome', 'Who', 'Patient', 'Details', 'Hash'].map(h => (
                <th key={h} className="px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 align-top">
            {rows.map(r => (
              <tr key={r.seq}>
                <td className="px-3 py-2 tabular-nums">{r.seq}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(r.recordedAt)}</td>
                <td className="px-3 py-2 font-mono">{r.type}</td>
                <td className={`px-3 py-2 font-semibold ${OUTCOME_TONE[r.outcome]}`}>{r.outcome}</td>
                <td className="min-w-48 px-3 py-2">{r.actor}</td>
                <td className="px-3 py-2 font-mono">{r.patientRef ? `${r.patientRef}…` : ''}</td>
                <td className="max-w-xs break-words px-3 py-2 font-mono text-[11px] text-gray-700">{r.details ? JSON.stringify(r.details) : ''}</td>
                <td className="px-3 py-2 font-mono text-gray-500">{r.hash.slice(0, 10)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {more && (
        <Button variant="secondary" onClick={() => load(rows.at(-1)?.seq)}>
          Older events
        </Button>
      )}
    </div>
  )
}

interface ConsentRow {
  id: string
  status: string
  patient: string
  provider: string
  providerType: string
  purpose: string
  requestedAt: string
  assurance: string | null
  actions: string[]
  expiresAt: string | null
  withdrawnBy: string | null
}

function ConsentRegister() {
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<ConsentRow[] | null>(null)
  useEffect(() => {
    let cancelled = false
    api<ConsentRow[]>(`/api/admin/consents${status ? `?status=${status}` : ''}`).then(r => !cancelled && r.ok && setRows(r.data))
    return () => {
      cancelled = true
    }
  }, [status])
  return (
    <div className="space-y-4">
      <label className="block max-w-xs text-sm">
        Status
        <select className="mt-1 block w-full rounded border border-gray-400 px-2 py-1.5" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All</option>
          {['pending', 'active', 'declined', 'withdrawn', 'expired'].map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {!rows ? (
        <p className="text-gray-600">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-600">No consents.</p>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                {['Status', 'Patient', 'Provider', 'Purpose', 'Requested', 'Signed in with', 'Can', 'Until'].map(h => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 align-top">
              {rows.map(c => (
                <tr key={c.id}>
                  <td className="px-3 py-2">
                    <StatusTag audience="provider" status={c.status} />
                    {c.withdrawnBy && <div className="text-xs text-gray-600">by {c.withdrawnBy}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono">{c.patient}</td>
                  <td className="px-3 py-2">
                    {c.provider}
                    <div className="text-xs text-gray-600">{c.providerType}</div>
                  </td>
                  <td className="px-3 py-2">{c.purpose}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(c.requestedAt)}</td>
                  <td className="px-3 py-2">{c.assurance === 'nhs-login-p9' ? 'NHS login' : c.assurance === 'sms-otp' ? 'Text code' : ''}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.actions.join(' ')}</td>
                  <td className="whitespace-nowrap px-3 py-2">{c.status === 'active' ? formatDate(c.expiresAt) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

const ADAPTER_LABELS: Record<string, string> = {
  pds: 'PDS (demographics)',
  sds: 'SDS (endpoint lookup)',
  'nhs-login': 'NHS login',
  sms: 'SMS',
  'gp-connect': 'GP Connect (GP systems)',
  mesh: 'MESH (Send Document)',
}

function Faults({ canChange }: { canChange: boolean }) {
  const [rows, setRows] = useState<Array<{ adapter: string; fault: { kind: string; ms?: number } | null }>>([])
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await api<typeof rows>('/api/admin/faults')
    if (r.ok) setRows(r.data)
  }, [])
  useEffect(() => {
    let cancelled = false
    api<typeof rows>('/api/admin/faults').then(r => !cancelled && r.ok && setRows(r.data))
    return () => {
      cancelled = true
    }
  }, [])

  async function set(adapter: string, kind: string) {
    const res = await fetch(`/api/admin/faults/${adapter}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(kind === 'latency' ? { kind, ms: 3000 } : { kind }),
    })
    if (!res.ok) setError(((await res.json()) as { message?: string }).message ?? 'Failed')
    else setError(null)
    load()
  }

  return (
    <div className="space-y-4">
      <SimNote>
        Make a simulated national service misbehave, to show how the service and its users cope. Changes apply to everyone using this demo within a
        couple of seconds, and are audited.{!canChange && ' You are signed in as an auditor, so these are read-only.'}
      </SimNote>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => {
              const current = r.fault?.kind ?? 'none'
              return (
                <tr key={r.adapter}>
                  <td className="px-4 py-3 font-semibold">{ADAPTER_LABELS[r.adapter] ?? r.adapter}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={ADAPTER_LABELS[r.adapter]}>
                      {[
                        ['none', 'Normal'],
                        ['latency', 'Slow (3s)'],
                        ['timeout', 'Times out'],
                        ['unavailable', 'Unavailable'],
                      ].map(([kind, label]) => (
                        <button
                          key={kind}
                          role="radio"
                          aria-checked={current === kind}
                          disabled={!canChange}
                          onClick={() => set(r.adapter, kind)}
                          className={`rounded px-3 py-1 text-sm ring-1 ring-inset disabled:cursor-not-allowed ${
                            current === kind ? (kind === 'none' ? 'bg-green-700 text-white ring-green-700' : 'bg-red-700 text-white ring-red-700') : 'bg-white ring-gray-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
