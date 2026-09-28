import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import Link from '../../Link'
import { Card, ErrorBox, SimNote } from '../../ui'
import type { ProviderSession } from './types'
import { useProviderSession } from './useProviderSession'

interface SimUser {
  userId: string
  name: string
  role: string
  active: boolean
  organisation: { name: string; typeLabel: string; active: boolean }
}

function SimSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [users, setUsers] = useState<SimUser[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api<SimUser[]>('/api/provider/sim/users').then(r => r.ok && setUsers(r.data))
  }, [])
  async function signIn(userId: string) {
    const res = await api('/api/provider/sim-login', { body: { userId } })
    if (res.ok) onSignedIn()
    else setError(res.message)
  }
  return (
    <div className="max-w-2xl space-y-5">
      <h2 className="text-2xl font-semibold">Provider sign-in</h2>
      <SimNote>
        Simulated sign-in. A real service would use NHS Care Identity Service 2 (CIS2), or an identity provider with
        phishing-resistant multi-factor authentication, and would check professional registration.
      </SimNote>
      {error && <ErrorBox>{error}</ErrorBox>}
      <ul className="grid gap-2">
        {users.map(u => (
          <li key={u.userId}>
            <button className="w-full text-left" onClick={() => signIn(u.userId)}>
              <Card className="hover:border-brand">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{u.name}</span>
                  <span className="text-xs text-gray-600">
                    {u.role}
                    {!u.active && ' · account disabled'}
                  </span>
                </div>
                <div className="text-sm text-gray-700">
                  {u.organisation.name} · {u.organisation.typeLabel}
                  {!u.organisation.active && <span className="ml-1 text-red-700">(suspended)</span>}
                </div>
              </Card>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Wraps provider pages: sign-in if needed, then a header with who you are. */
export default function ProviderFrame({ children }: { children: (session: ProviderSession) => ReactNode }) {
  const { session, refresh } = useProviderSession()
  if (session === undefined) return <p className="text-gray-600">Loading…</p>
  if (session === null) return <SimSignIn onSignedIn={refresh} />
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-200 bg-white px-4 py-3 text-sm">
        <div>
          <span className="font-semibold">{session.user.name}</span> · {session.organisation.name} ({session.organisation.typeLabel})
          {!session.organisation.active && <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-red-800">Organisation suspended</span>}
        </div>
        <div className="flex gap-4">
          <Link className="text-brand underline" href="/provider">
            Patients
          </Link>
          <button
            className="text-brand underline"
            onClick={async () => {
              await api('/api/provider/logout', { body: {} })
              refresh()
            }}
          >
            Sign out
          </button>
        </div>
      </div>
      {children(session)}
    </div>
  )
}
