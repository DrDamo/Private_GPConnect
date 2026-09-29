import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import Link from '../../Link'
import { formatDate } from '../../format'
import { Button, Card, ErrorBox, Notice, SimNote, StatusTag } from '../../ui'
import { startNhsLogin } from './signIn'
import type { ConsentView, Session } from './types'

type Stage =
  | { kind: 'loading' }
  | { kind: 'choose' }
  | { kind: 'sms'; challengeId: string; sentTo: string }
  | { kind: 'view'; consent: ConsentView }
  | { kind: 'wrong-person' }

async function fetchStage(id: string): Promise<{ session: Session; stage: Stage; error: string | null }> {
  const s = await api<Session>('/api/patient/session')
  const session: Session = s.ok ? s.data : { authenticated: false }
  if (!session.authenticated) return { session, stage: { kind: 'choose' }, error: null }
  const res = await api<ConsentView>(`/api/patient/consents/${id}`)
  if (res.ok) return { session, stage: { kind: 'view', consent: res.data }, error: null }
  if (res.status === 404) return { session, stage: { kind: 'wrong-person' }, error: null }
  if (res.status === 401) return { session, stage: { kind: 'choose' }, error: null }
  return { session, stage: { kind: 'choose' }, error: res.message }
}

export default function ConsentReview({ id }: { id: string }) {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' })
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const result = await fetchStage(id)
    setSession(result.session)
    setError(result.error)
    setStage(result.stage)
  }, [id])

  useEffect(() => {
    let cancelled = false
    fetchStage(id).then(result => {
      if (cancelled) return
      setSession(result.session)
      setError(result.error)
      setStage(result.stage)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  async function signOut() {
    await api('/api/patient/logout', { body: {} })
    load()
  }

  async function sendCode() {
    setBusy(true)
    setError(null)
    const res = await api<{ challengeId: string; sentTo: string }>('/api/patient/sms/start', { body: { consentId: id } })
    setBusy(false)
    if (res.ok) setStage({ kind: 'sms', ...res.data })
    else setError(res.message)
  }

  if (stage.kind === 'loading') return <p className="text-gray-600">Loading…</p>

  if (stage.kind === 'wrong-person') {
    return (
      <div className="max-w-2xl space-y-4">
        <h2 className="text-2xl font-semibold">This request is not for the person signed in</h2>
        <p>
          You are signed in as {session?.name ?? 'someone else'}. If the request was sent to you, sign out and sign in as
          yourself.
        </p>
        <Button variant="secondary" onClick={signOut}>
          Sign out
        </Button>
      </div>
    )
  }

  if (stage.kind === 'choose') {
    return (
      <div className="max-w-2xl space-y-5">
        <h2 className="text-2xl font-semibold">A healthcare provider has asked to see your GP record</h2>
        <p>To see who is asking and what they want to see, first prove it is you.</p>
        {error && <ErrorBox>{error}</ErrorBox>}
        <Card className="space-y-3">
          <h3 className="text-lg font-semibold">Sign in with NHS login</h3>
          <p className="text-sm text-gray-700">Recommended. You can agree to everything the provider asked for, and see all your requests and who has looked at your record.</p>
          <Button
            onClick={async () => {
              const err = await startNhsLogin(`/patient/consent/${id}`)
              if (err) setError(err)
            }}
          >
            Continue with NHS login
          </Button>
        </Card>
        <Card className="space-y-3">
          <h3 className="text-lg font-semibold">Use a text message code instead</h3>
          <p className="text-sm text-gray-700">
            We will text a code to the mobile number your GP practice has for you. This is less secure, so you can only let the
            provider <em>look at</em> your record (and tell your GP about any care they give you), for up to 30 days.
          </p>
          <Button variant="secondary" onClick={sendCode} disabled={busy}>
            Text me a code
          </Button>
        </Card>
      </div>
    )
  }

  if (stage.kind === 'sms') {
    return <SmsCodeForm challengeId={stage.challengeId} sentTo={stage.sentTo} onDone={load} onResend={sendCode} error={error} />
  }

  return <ConsentDetails consent={stage.consent} session={session} onChange={c => setStage({ kind: 'view', consent: c })} />
}

function SmsCodeForm(props: { challengeId: string; sentTo: string; onDone: () => void; onResend: () => void; error: string | null }) {
  const [code, setCode] = useState('')
  const [dob, setDob] = useState({ day: '', month: '', year: '' })
  const [error, setError] = useState<string | null>(props.error)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const birthDate = `${dob.year.padStart(4, '0')}-${dob.month.padStart(2, '0')}-${dob.day.padStart(2, '0')}`
    setBusy(true)
    const res = await api('/api/patient/sms/verify', { body: { challengeId: props.challengeId, code, birthDate } })
    setBusy(false)
    if (res.ok) props.onDone()
    else setError(res.message + (typeof res.details.attemptsLeft === 'number' ? ` You have ${res.details.attemptsLeft} attempts left.` : ''))
  }

  const field = 'mt-1 block rounded border border-gray-400 px-3 py-2'
  return (
    <form onSubmit={submit} className="max-w-xl space-y-5">
      <h2 className="text-2xl font-semibold">Check your phone</h2>
      <p>We have sent a 6-digit code to {props.sentTo}. It expires in 10 minutes.</p>
      <SimNote>
        Simulation: no real text is sent. Open the{' '}
        <a className="underline" href="/sim/phone" target="_blank" rel="noreferrer">
          simulated phone
        </a>{' '}
        to read it.
      </SimNote>
      {error && <ErrorBox>{error}</ErrorBox>}
      <label className="block">
        <span className="font-semibold">Code</span>
        <input className={`${field} w-40 font-mono tracking-widest`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required />
      </label>
      <fieldset>
        <legend className="font-semibold">Your date of birth</legend>
        <p className="text-sm text-gray-600">For example, 27 3 1985</p>
        <div className="mt-1 flex gap-3">
          {(['day', 'month', 'year'] as const).map(part => (
            <label key={part} className="text-sm capitalize">
              {part}
              <input
                className={`${field} ${part === 'year' ? 'w-24' : 'w-16'}`}
                inputMode="numeric"
                maxLength={part === 'year' ? 4 : 2}
                value={dob[part]}
                onChange={e => setDob({ ...dob, [part]: e.target.value.replace(/\D/g, '') })}
                required
              />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={busy || code.length !== 6}>
          Continue
        </Button>
        <button type="button" className="text-brand underline" onClick={props.onResend}>
          Send a new code
        </button>
      </div>
    </form>
  )
}

function ConsentDetails({ consent, session, onChange }: { consent: ConsentView; session: Session | null; onChange: (c: ConsentView) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)

  async function decide(decision: 'grant' | 'decline') {
    setBusy(true)
    setError(null)
    const res = await api<ConsentView>(`/api/patient/consents/${consent.id}/decision`, {
      body: { decision, consentTextVersion: consent.consentTextVersion, consentTextHash: consent.consentTextHash },
    })
    setBusy(false)
    if (res.ok) onChange(res.data)
    else setError(res.message)
  }

  async function withdraw() {
    setBusy(true)
    const res = await api<ConsentView>(`/api/patient/consents/${consent.id}/withdraw`, { body: {} })
    setBusy(false)
    setConfirmWithdraw(false)
    if (res.ok) onChange(res.data)
    else setError(res.message)
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold">{consent.provider.name}</h2>
        <StatusTag status={consent.status} />
      </div>
      <p className="text-gray-700">
        {consent.provider.typeLabel} · asked on {formatDate(consent.requestedAt)} by {consent.requestedBy}
      </p>
      {error && <ErrorBox>{error}</ErrorBox>}

      <Card className="space-y-4">
        <div>
          <h3 className="font-semibold">Why they are asking</h3>
          <p>{consent.purpose}</p>
        </div>
        <div>
          <h3 className="font-semibold">{consent.status === 'pending' ? 'If you agree, they can' : 'What they can do'}</h3>
          <ul className="ml-5 list-disc">
            {consent.permissions.map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">The parts of your record they can see</h3>
          <p>{consent.recordParts.join(', ')}</p>
        </div>
        <div>
          <h3 className="font-semibold">How long for</h3>
          <p>
            {consent.status === 'active' && consent.expiresAt
              ? `Until ${formatDate(consent.expiresAt)}, unless you withdraw sooner`
              : `${consent.durationDays} days from when you agree, unless you withdraw sooner`}
          </p>
        </div>
      </Card>

      {consent.status === 'pending' && (
        <>
          {consent.narrowedBySignIn && (
            <Notice>
              Because you signed in with a text message code, you can only let them look at your record and tell your GP about your care, for up to 30 days. They cannot copy your record into their own system.
              To agree to everything they asked for,{' '}
              <button
                className="underline"
                onClick={async () => {
                  await api('/api/patient/logout', { body: {} })
                  const err = await startNhsLogin(`/patient/consent/${consent.id}`)
                  if (err) setError(err)
                }}
              >
                sign in with NHS login
              </button>{' '}
              instead.
            </Notice>
          )}
          <details className="rounded border border-gray-300 bg-white p-3">
            <summary className="cursor-pointer font-semibold">Read the full wording you are agreeing to</summary>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{consent.consentText}</pre>
            <p className="mt-2 text-xs text-gray-500">Version {consent.consentTextVersion}</p>
          </details>
          <p className="text-sm text-gray-700">
            You can withdraw at any time. Withdrawing stops further access but does not remove what they have already seen.
            Please respond by {formatDate(consent.requestExpiresAt)}.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => decide('grant')} disabled={busy}>
              I agree
            </Button>
            <Button variant="secondary" onClick={() => decide('decline')} disabled={busy}>
              I do not agree
            </Button>
          </div>
        </>
      )}

      {consent.status === 'active' && (
        <Card className="space-y-3">
          <p>
            You agreed on {formatDate(consent.decision?.at)}. Every time they look at your record it is logged
            {session?.assurance === 'nhs-login-p9' && (
              <>
                {' '}
                on{' '}
                <Link className="text-brand underline" href="/patient">
                  your record access page
                </Link>
              </>
            )}
            .
          </p>
          {!confirmWithdraw ? (
            <Button variant="danger" onClick={() => setConfirmWithdraw(true)}>
              Withdraw consent
            </Button>
          ) : (
            <div className="space-y-3 rounded border border-red-300 bg-red-50 p-3">
              <p className="font-semibold">Withdraw consent from {consent.provider.name}?</p>
              <p className="text-sm">They will not be able to see your GP record again unless you agree to a new request.</p>
              <div className="flex gap-3">
                <Button variant="danger" onClick={withdraw} disabled={busy}>
                  Yes, withdraw
                </Button>
                <Button variant="secondary" onClick={() => setConfirmWithdraw(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {consent.status === 'declined' && <Notice>You did not agree. {consent.provider.name} cannot see your GP record.</Notice>}
      {consent.status === 'withdrawn' && <Notice>Consent was withdrawn on {formatDate(consent.withdrawal?.at)}. No further access is allowed.</Notice>}
      {consent.status === 'expired' && <Notice>This has expired. No further access is allowed.</Notice>}

      {session?.assurance === 'nhs-login-p9' && (
        <Link className="text-brand underline" href="/patient">
          See all your requests and who has accessed your record
        </Link>
      )}
    </div>
  )
}
