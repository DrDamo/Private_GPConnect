import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import Link from '../../Link'
import { navigate, useLocation } from '../../router'
import { ErrorBox } from '../../ui'

export default function Callback() {
  const { search } = useLocation()
  const [failure, setFailure] = useState<string | null>(null)
  const started = useRef(false)
  const code = search.get('code')
  const state = search.get('state')
  const error = !code || !state ? 'Sign-in did not complete. Please try again.' : failure

  useEffect(() => {
    if (started.current || !code || !state) return // StrictMode runs effects twice; a code is single-use
    started.current = true
    api<{ returnTo: string }>('/api/patient/nhs-login/callback', { body: { code, state } }).then(res => {
      if (res.ok) navigate(res.data.returnTo, { replace: true })
      else setFailure(res.message)
    })
  }, [code, state])

  if (error) {
    return (
      <div className="max-w-xl space-y-4">
        <h2 className="text-xl font-semibold">We could not sign you in</h2>
        <ErrorBox>{error}</ErrorBox>
        <Link className="text-brand underline" href="/patient">
          Back to your GP record access
        </Link>
      </div>
    )
  }
  return <p className="text-gray-600">Signing you in…</p>
}
