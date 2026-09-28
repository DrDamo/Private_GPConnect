import { useEffect, useState } from 'react'

// Minimal client-side routing: enough for a handful of pages without a
// dependency. Vercel rewrites unknown paths to index.html.

export function navigate(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return path
}
