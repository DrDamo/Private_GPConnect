import { useEffect, useState } from 'react'

export type ApiHealth =
  | { state: 'loading' }
  | { state: 'ok'; version: string; commit: string | null }
  | { state: 'error'; message: string }

export function useApiHealth(): ApiHealth {
  const [health, setHealth] = useState<ApiHealth>({ state: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { version: string; commit: string | null }
        setHealth({ state: 'ok', version: body.version, commit: body.commit })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setHealth({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => controller.abort()
  }, [])

  return health
}
