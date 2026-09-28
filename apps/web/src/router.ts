import { useEffect, useState } from 'react'

// Minimal client-side routing: enough for a handful of pages without a
// dependency. Vercel rewrites unknown paths to index.html.

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (options.replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export interface Location {
  path: string
  search: URLSearchParams
}

export function useLocation(): Location {
  const read = () => ({ path: window.location.pathname, search: new URLSearchParams(window.location.search) })
  const [loc, setLoc] = useState(read)
  useEffect(() => {
    const onPop = () => setLoc(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return loc
}
