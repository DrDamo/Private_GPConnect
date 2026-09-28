import { useEffect, useState } from 'react'

export type ApiState<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; message: string }

export function useApi<T>(url: string): ApiState<T> {
  const [result, setResult] = useState<ApiState<T>>({ state: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    fetch(url, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setResult({ state: 'ok', data: (await res.json()) as T })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ state: 'error', message: err instanceof Error ? err.message : String(err) })
        }
      })
    return () => controller.abort()
  }, [url])
  return result
}
