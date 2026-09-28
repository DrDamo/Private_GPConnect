import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useLocation } from '../../router'
import { Card, ErrorBox, SimNote } from '../../ui'

interface Persona {
  sub: string
  displayName: string
  nhsNumber: string
  identityProofingLevel: 'P9' | 'P5'
}

// Stands in for the real NHS login pages. Deliberately looks different from
// NHS login so nobody mistakes it for the real thing.
export default function NhsLoginSim() {
  const { search } = useLocation()
  const [personas, setPersonas] = useState<Persona[]>([])
  const [error, setError] = useState<string | null>(null)
  const state = search.get('state')
  const nonce = search.get('nonce')
  const redirectUri = search.get('redirect_uri')

  useEffect(() => {
    api<Persona[]>('/api/sim/nhs-login/personas').then(r => (r.ok ? setPersonas(r.data) : setError(r.message)))
  }, [])

  async function choose(sub: string) {
    const res = await api<{ location: string }>('/api/sim/nhs-login/authorize', { body: { sub, state, nonce, redirectUri } })
    if (res.ok) window.location.assign(res.data.location)
    else setError(res.message)
  }

  if (!state || !nonce || !redirectUri) return <ErrorBox>This page must be opened from a sign-in button.</ErrorBox>

  return (
    <div className="max-w-2xl space-y-5">
      <h2 className="text-2xl font-semibold">Simulated NHS login</h2>
      <SimNote>
        This is <strong>not</strong> the real NHS login. Choose a synthetic person to sign in as. People verified only to P5 are
        included to show what happens when identity is not fully proven.
      </SimNote>
      {error && <ErrorBox>{error}</ErrorBox>}
      <ul className="grid gap-2">
        {personas.map(p => (
          <li key={p.sub}>
            <button className="w-full text-left" onClick={() => choose(p.sub)}>
              <Card className="flex items-center justify-between hover:border-brand">
                <span>
                  <span className="font-semibold">{p.displayName}</span>
                  <span className="ml-2 font-mono text-sm text-gray-600">{p.nhsNumber}</span>
                </span>
                <span className={`rounded px-2 py-0.5 text-xs ${p.identityProofingLevel === 'P9' ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900'}`}>
                  {p.identityProofingLevel === 'P9' ? 'Verified (P9)' : 'Not fully verified (P5)'}
                </span>
              </Card>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
