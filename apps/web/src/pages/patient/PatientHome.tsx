import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import Link from '../../Link'
import { formatDate, formatDateTime } from '../../format'
import { Button, Card, ErrorBox, Notice, StatusTag } from '../../ui'
import { startNhsLogin } from './signIn'
import type { AccessLogEntry, ConsentView, Session } from './types'

interface Loaded {
  session: Session
  consents: ConsentView[] | null
  log: AccessLogEntry[] | null
  error: string | null
}

async function fetchAll(): Promise<Loaded> {
  const s = await api<Session>('/api/patient/session')
  const session: Session = s.ok ? s.data : { authenticated: false }
  if (!session.authenticated || session.assurance !== 'nhs-login-p9') return { session, consents: null, log: null, error: null }
  const [c, l] = await Promise.all([
    api<ConsentView[]>('/api/patient/me/consents'),
    api<AccessLogEntry[]>('/api/patient/me/access-log'),
  ])
  return { session, consents: c.ok ? c.data : null, log: l.ok ? l.data : null, error: c.ok ? null : c.message }
}

export default function PatientHome() {
  const [session, setSession] = useState<Session | null>(null)
  const [consents, setConsents] = useState<ConsentView[] | null>(null)
  const [log, setLog] = useState<AccessLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback((d: Loaded) => {
    setSession(d.session)
    setConsents(d.consents)
    setLog(d.log)
    setError(d.error)
  }, [])

  const load = useCallback(async () => apply(await fetchAll()), [apply])

  useEffect(() => {
    let cancelled = false
    fetchAll().then(d => !cancelled && apply(d))
    return () => {
      cancelled = true
    }
  }, [apply])

  async function signOut() {
    await api('/api/patient/logout', { body: {} })
    load()
  }

  if (!session) return <p className="text-gray-600">Loading…</p>

  if (!session.authenticated || session.assurance !== 'nhs-login-p9') {
    return (
      <div className="max-w-2xl space-y-5">
        <h2 className="text-2xl font-semibold">Your GP record: who can see it</h2>
        <p>
          Sign in to see which private healthcare providers have asked to see your GP record, what you agreed to, and every time
          your record was accessed. You can withdraw consent at any time.
        </p>
        {session.authenticated && session.assurance === 'sms-otp' && (
          <Notice>
            You signed in with a text message code, which only lets you respond to{' '}
            <Link className="underline" href={`/patient/consent/${session.consentId}`}>
              one request
            </Link>
            . Sign in with NHS login to see everything.
          </Notice>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
        <Button
          onClick={async () => {
            const err = await startNhsLogin('/patient')
            if (err) setError(err)
          }}
        >
          Continue with NHS login
        </Button>
      </div>
    )
  }

  const open = consents?.filter(c => c.status === 'pending') ?? []
  const active = consents?.filter(c => c.status === 'active') ?? []
  const past = consents?.filter(c => !['pending', 'active'].includes(c.status)) ?? []

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-2xl font-semibold">{session.name ?? 'Your GP record'}</h2>
        <button className="text-brand underline" onClick={signOut}>
          Sign out
        </button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}

      <ConsentList title="Waiting for your answer" items={open} empty="No requests are waiting for you." />
      <ConsentList title="Providers who can see your record" items={active} empty="No provider can currently see your GP record." />
      {past.length > 0 && <ConsentList title="Past requests" items={past} empty="" />}

      <section>
        <h3 className="mb-3 text-lg font-semibold">Everything that has happened with your record</h3>
        {!log?.length ? (
          <p className="text-gray-600">Nothing yet.</p>
        ) : (
          <Card className="p-0">
            <ol className="divide-y divide-gray-100">
              {log.map(e => (
                <li key={e.seq} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-6">
                  <time className="shrink-0 text-sm text-gray-600 sm:w-44" dateTime={e.at}>
                    {formatDateTime(e.at)}
                  </time>
                  <span className={e.outcome === 'success' ? '' : 'text-red-800'}>{e.description}</span>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </section>
    </div>
  )
}

function ConsentList({ title, items, empty }: { title: string; items: ConsentView[]; empty: string }) {
  return (
    <section>
      <h3 className="mb-3 text-lg font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-gray-600">{empty}</p>
      ) : (
        <ul className="grid gap-3">
          {items.map(c => (
            <li key={c.id}>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link className="font-semibold text-brand underline" href={`/patient/consent/${c.id}`}>
                    {c.provider.name}
                  </Link>
                  <StatusTag status={c.status} />
                </div>
                <p className="mt-1 text-sm text-gray-700">
                  {c.provider.typeLabel} · {c.purpose}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  {c.status === 'active' && c.expiresAt && `Until ${formatDate(c.expiresAt)}`}
                  {c.status === 'pending' && `Respond by ${formatDate(c.requestExpiresAt)}`}
                  {c.status === 'withdrawn' && `Withdrawn ${formatDate(c.withdrawal?.at)}`}
                  {c.status === 'declined' && `Declined ${formatDate(c.decision?.at)}`}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
