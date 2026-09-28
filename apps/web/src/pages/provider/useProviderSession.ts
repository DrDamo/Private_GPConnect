import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import type { ProviderSession } from './types'

export function useProviderSession() {
  const [session, setSession] = useState<ProviderSession | null | undefined>(undefined)
  const refresh = useCallback(async () => {
    const res = await api<ProviderSession>('/api/provider/session')
    setSession(res.ok ? res.data : null)
  }, [])
  useEffect(() => {
    let cancelled = false
    api<ProviderSession>('/api/provider/session').then(res => !cancelled && setSession(res.ok ? res.data : null))
    return () => {
      cancelled = true
    }
  }, [])
  return { session, refresh }
}
